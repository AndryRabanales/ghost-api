// andryrabanales/ghost-api/ghost-api-282b77c99f664dcc9acae14a9880ffdd34fc9b54/routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ✅ CORRECCIÓN: Importación segura de lives.js
const livesUtils = require("../utils/lives"); 

const { sanitize } = require("../utils/sanitize"); 
// --- 👇 1. MODIFICACIÓN: Importar ambas funciones de IA 👇 ---
const { analyzeMessage, analyzeCreatorResponse } = require("../utils/aiAnalyzer");

async function dashboardChatsRoutes(fastify, opts) {

  /**
   * Enviar mensaje como creador (LIBERA FONDOS)
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

      // --- 👇 2. MODIFICACIÓN: BARRERA DE CALIDAD MÍNIMA (40) 👇 ---
      const MIN_LENGTH = 40; // Subido a 50 caracteres
      if (!cleanContent || cleanContent.trim().length < MIN_LENGTH) {
        return reply.code(400).send({ error: `La respuesta debe tener al menos ${MIN_LENGTH} caracteres.` });
      }

      // --- 👇 3. MODIFICACIÓN: DOBLE VALIDACIÓN DE IA (Seguridad + Calidad + Contexto) 👇 ---
      try {
        // Chequeo 1: Seguridad (rápido)
        const safetyCheck = await analyzeMessage(cleanContent);
        if (!safetyCheck.isSafe) {
          return reply.code(400).send({ error: safetyCheck.reason || 'Tu respuesta fue bloqueada por moderación.' });
        }
        
        // Chequeo 2: Calidad vs Contrato y Contexto
        // Obtenemos el contrato que el creador prometió
        const creator = await prisma.creator.findUnique({
          where: { id: dashboardId },
          select: { premiumContract: true }
        });
        
        // Buscamos la última pregunta del anónimo para darle contexto a la IA
        const lastAnonMessage = await prisma.chatMessage.findFirst({
            where: { chatId: chatId, from: 'anon' },
            orderBy: { createdAt: 'desc' },
            select: { content: true }
        });

        // Llamamos a la IA con el contexto
        const qualityCheck = await analyzeCreatorResponse(
            cleanContent, 
            creator.premiumContract, 
            lastAnonMessage?.content // Pasamos la pregunta del anónimo
        );

        if (!qualityCheck.success) {
          // La IA determinó que la RESPUESTA es de baja calidad o irrelevante
          return reply.code(400).send({ 
            error: `Respuesta rechazada: ${qualityCheck.reason}. Ajusta tu mensaje para liberar tu pago.` 
          });
        }
        
      } catch (aiError) {
        fastify.log.error(aiError, "Error en la validación de IA de la respuesta del creador");
        // Si la IA falla catastróficamente, es más seguro bloquear la respuesta
        return reply.code(500).send({ error: "Error en el servicio de análisis de IA. Intenta de nuevo." });
      }
      // --- 👆 FIN: VALIDACIÓN DE IA 👆 ---

      // --- Si pasa la validación, el código continúa ---

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

      // IMPLEMENTACIÓN PILAR 2: LIBERACIÓN DE FONDOS
      // (Esta lógica ahora solo se ejecuta si la IA da el OK)
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
      
      // Actualiza el estado activo del creador
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
      fastify.log.error("❌ Error en POST /dashboard/:dashboardId/chats/:chatId/messages:", err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });

  /**
   * Obtener todos los mensajes de un chat (lado creador)
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
  
      creator = await livesUtils.refillLivesIfNeeded(creator); 
  
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
        chat = await prisma.chat.findFirst({
            where: { id: chatId, creatorId: dashboardId },
            include: {
              messages: { orderBy: { createdAt: "asc" } },
            },
        });
      }

      // Lógica de tiempo de expiración (24 Horas)
      const lastAnonTip = await prisma.chatMessage.findFirst({
        where: { chatId: chatId, from: 'anon', tipStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, tipAmount: true }
      });
      
      let tipExpiresInMinutes = null;
      const EXPIRATION_HOURS = 24; // 24 horas para responder
      
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
              // (La ruta de admin.js también hace esto, pero es bueno tener redundancia)
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
        livesLeft: creator.lives,
        // ✅ Usamos la función a través del objeto importado
        minutesToNextLife: livesUtils.minutesToNextLife(creator),
        tipExpiresInMinutes: tipExpiresInMinutes,
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats/:chatId:", err);
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });

  /**
   * Abrir un chat (Asegura vidas ilimitadas para todos)
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

      let updatedCreator;

      if (!chat.isOpened) {
        // ✅ Usamos la función a través del objeto importado
        updatedCreator = await livesUtils.consumeLife(dashboardId);
        
        await prisma.chat.update({
          where: { id: chatId },
          data: { isOpened: true },
        });
      } else {
        updatedCreator = await prisma.creator.findUnique({ where: { id: dashboardId } });
        // ✅ Usamos la función a través del objeto importado
        updatedCreator = await livesUtils.refillLivesIfNeeded(updatedCreator); 
      }

      reply.send({
        ok: true,
        livesLeft: updatedCreator.lives,
        // ✅ Usamos la función a través del objeto importado
        minutesToNextLife: livesUtils.minutesToNextLife(updatedCreator),
      });
    } catch (err) {
      fastify.log.error("❌ Error en POST /dashboard/:dashboardId/chats/:chatId/open:", err);
      reply.code(500).send({ error: "Error abriendo chat" });
    }
  });
}

module.exports = dashboardChatsRoutes;