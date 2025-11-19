const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const { sanitize } = require("../utils/sanitize"); 
const { analyzeMessage, analyzeCreatorResponse } = require("../utils/aiAnalyzer");

async function dashboardChatsRoutes(fastify, opts) {

  /**
   * Enviar mensaje como creador (LIBERA FONDOS)
   * Mantiene la validación de IA y seguridad.
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      
      const cleanContent = sanitize(req.body.content);

      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      // 1. BARRERA DE CALIDAD MÍNIMA
      const MIN_LENGTH = 40; 
      if (!cleanContent || cleanContent.trim().length < MIN_LENGTH) {
        return reply.code(400).send({ error: `La respuesta debe tener al menos ${MIN_LENGTH} caracteres.` });
      }

      // 2. DOBLE VALIDACIÓN DE IA
      try {
        // A. Seguridad
        const safetyCheck = await analyzeMessage(cleanContent);
        if (!safetyCheck.isSafe) {
          return reply.code(400).send({ error: safetyCheck.reason || 'Tu respuesta fue bloqueada por moderación.' });
        }
        
        // B. Calidad vs Contrato
        const creator = await prisma.creator.findUnique({
          where: { id: dashboardId },
          select: { premiumContract: true }
        });
        
        const lastAnonMessage = await prisma.chatMessage.findFirst({
            where: { chatId: chatId, from: 'anon' },
            orderBy: { createdAt: 'desc' },
            select: { content: true }
        });

        const qualityCheck = await analyzeCreatorResponse(
            cleanContent, 
            creator.premiumContract, 
            lastAnonMessage?.content 
        );

        if (!qualityCheck.success) {
          return reply.code(400).send({ 
            error: `Respuesta rechazada: ${qualityCheck.reason}. Ajusta tu mensaje para liberar tu pago.` 
          });
        }
        
      } catch (aiError) {
        fastify.log.error(aiError, "Error en la validación de IA");
        return reply.code(500).send({ error: "Error en el servicio de análisis de IA. Intenta de nuevo." });
      }

      // 3. PROCESAR MENSAJE
      const chat = await prisma.chat.findUnique({
        where: { id: chatId }
      });

      if (!chat || chat.creatorId !== dashboardId) {
        return reply.code(404).send({ error: "Chat no encontrado o no pertenece al creador" });
      }
      
      const msg = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "creator",
          content: cleanContent, 
        },
      });

      // 4. LIBERACIÓN DE FONDOS (Pilar 2)
      const lastAnonTip = await prisma.chatMessage.findFirst({
        where: {
          chatId: chatId,
          from: 'anon',
          tipStatus: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
      });

      if (lastAnonTip) {
        await prisma.chatMessage.update({
          where: { id: lastAnonTip.id },
          data: { 
            tipStatus: 'FULFILLED',
          }
        });
        fastify.log.info(`Propina del mensaje ${lastAnonTip.id} liberada por el creador ${dashboardId}.`);
      }
      
      // Actualiza estado activo
      await prisma.creator.update({
          where: { id: dashboardId },
          data: { lastActive: new Date() }
      });

      const payload = {
        type: "message",
        ...msg,
      };
      fastify.broadcastToChat(chat.id, payload);
      fastify.broadcastToDashboard(chat.creatorId, payload);

      reply.code(201).send(msg);
    } catch (err) {
      fastify.log.error("❌ Error enviando mensaje:", err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });

  /**
   * Obtener todos los mensajes de un chat (lado creador)
   * Eliminada lógica de vidas y recarga.
   */
  fastify.get("/dashboard/:dashboardId/chats/:chatId", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
  
      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }
  
      let creator = await prisma.creator.findUnique({ where: { id: dashboardId } });
      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }
  
      // ❌ Eliminado: livesUtils.refillLivesIfNeeded(creator)
  
      let chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
        },
      });
  
      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado" });
      }
        
      // Resetear anonReplied a false al ver el chat
      if (chat.anonReplied) {
        await prisma.chat.update({
            where: { id: chatId },
            data: { anonReplied: false },
        });
        // Recargamos el chat para tener los datos actualizados si fuera necesario
        // (aunque para la lista de mensajes messages ya los tenemos)
      }

      // Lógica de tiempo de expiración (24 Horas) - Se mantiene
      const lastAnonTip = await prisma.chatMessage.findFirst({
        where: { chatId: chatId, from: 'anon', tipStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, tipAmount: true }
      });
      
      let tipExpiresInMinutes = null;
      const EXPIRATION_HOURS = 24; 
      
      if (lastAnonTip && lastAnonTip.tipAmount > 0) {
          const now = new Date();
          const tipCreatedAt = new Date(lastAnonTip.createdAt);
          const expirationTime = EXPIRATION_HOURS * 60 * 60 * 1000;
          const timeElapsed = now.getTime() - tipCreatedAt.getTime();
          const timeLeftMs = expirationTime - timeElapsed;

          if (timeLeftMs > 0) {
              tipExpiresInMinutes = Math.ceil(timeLeftMs / (1000 * 60));
          } else {
              // Si ya expiró, marcamos como NOT_FULFILLED
              await prisma.chatMessage.update({
                  where: { id: lastAnonTip.id },
                  data: { tipStatus: 'NOT_FULFILLED' }
              });
              tipExpiresInMinutes = 0; 
          }
      }
  
      reply.send({
        id: chat.id,
        anonToken: chat.anonToken,
        anonAlias: chat.anonAlias, 
        messages: chat.messages.map((m) => ({
          id: m.id,
          from: m.from,
          alias: m.alias || chat.anonAlias || "Anónimo",
          content: m.content,
          createdAt: m.createdAt,
          tipAmount: m.tipAmount,
          tipStatus: m.tipStatus,
        })),
        // ❌ Eliminados: livesLeft, minutesToNextLife
        tipExpiresInMinutes: tipExpiresInMinutes,
      });
    } catch (err) {
      fastify.log.error("❌ Error obteniendo chat:", err);
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });

  /**
   * Abrir un chat
   * Simplificado: Solo marca como abierto, sin consumir vidas.
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/open", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const { dashboardId, chatId } = req.params;

    if (req.user.id !== dashboardId) {
      return reply.code(403).send({ error: "No autorizado" });
    }

    try {
      let chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
      });

      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado" });
      }

      if (!chat.isOpened) {
        // Solo actualizamos el estado, sin tocar vidas
        await prisma.chat.update({
          where: { id: chatId },
          data: { isOpened: true },
        });
      }

      reply.send({ ok: true });

    } catch (err) {
      fastify.log.error("❌ Error abriendo chat:", err);
      reply.code(500).send({ error: "Error abriendo chat" });
    }
  });
}

module.exports = dashboardChatsRoutes;