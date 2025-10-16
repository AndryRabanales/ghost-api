// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { refillLivesIfNeeded, minutesToNextLife, consumeLife } = require("../utils/lives");
const { sanitize } = require("../utils/sanitize"); // 👈 1. IMPORTAR

async function dashboardChatsRoutes(fastify, opts) {

  /**
   * Enviar mensaje como creador (NO gasta vidas)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      
      // 👇 2. SANITIZAR ENTRADA
      const cleanContent = sanitize(req.body.content);

      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      // 👇 3. VALIDAR LA VARIABLE LIMPIA
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
          content: cleanContent, // 👈 4. USAR LA VARIABLE LIMPIA
        },
      });

      // ¡LA MAGIA OCURRE AQUÍ TAMBIÉN!
      const payload = {
        type: "message",
        ...msg,
      };
      fastify.broadcastToChat(chat.id, payload);

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
  
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
        },
      });
  
      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado" });
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
        })),
        livesLeft: creator.lives,
        minutesToNextLife: minutesToNextLife(creator),
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats/:chatId:", err);
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });
  
  /**
   * Abrir un chat (consume 1 vida solo si es nuevo)
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
        try {
          updatedCreator = await consumeLife(dashboardId);
          await prisma.chat.update({
            where: { id: chatId },
            data: { isOpened: true },
          });
        } catch (err) {
          const creator = await prisma.creator.findUnique({ where: { id: dashboardId } });
          return reply.code(403).send({
            error: err.message,
            minutesToNextLife: minutesToNextLife(creator),
            livesLeft: creator?.lives ?? 0,
          });
        }
      } else {
        updatedCreator = await prisma.creator.findUnique({ where: { id: dashboardId } });
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