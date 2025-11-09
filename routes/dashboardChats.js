// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ✅ CORRECCIÓN: Importación segura como objeto único
const livesUtils = require("../utils/lives"); 
const { refillLivesIfNeeded, minutesToNextLife, consumeLife } = livesUtils; 

const { sanitize } = require("../utils/sanitize"); 

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

      if (!cleanContent || cleanContent.trim() === "") {
        return reply.code(400).send({ error: "El mensaje no puede estar vacío" });
      }

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
      creator = await refillLivesIfNeeded(creator);
  
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
        livesLeft: creator.lives,
        minutesToNextLife: minutesToNextLife(creator),
        tipExpiresInMinutes: tipExpiresInMinutes,
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats/:chatId:", err);
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });
  
  /**
   * Abrir un chat (Ahora solo marca como abierto, no falla por vidas)
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
        // consumeLife ahora devuelve al creador sin fallar por vidas 
        updatedCreator = await consumeLife(dashboardId);
        
        await prisma.chat.update({
          where: { id: chatId },
          data: { isOpened: true },
        });
      } else {
        // Si ya estaba abierto, solo refrescamos el estado
        updatedCreator = await prisma.creator.findUnique({ where: { id: dashboardId } });
        updatedCreator = await refillLivesIfNeeded(updatedCreator); 
      }

      reply.send({
        ok: true,
        livesLeft: updatedCreator.lives,
        minutesToNextLife: minutesToNextLife(updatedCreator),
      });
    } catch (err) {
      fastify.log.error("❌ Error en POST /dashboard/:dashboardId/chats/:chatId/open:", err);
      reply.code(500).send({ error: "Error abriendo chat" });
    }
  });
}

module.exports = dashboardChatsRoutes;