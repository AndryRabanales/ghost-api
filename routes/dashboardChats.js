// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { refillLives, minutesToNextLife, consumeLife } = require("../utils/lives");

async function dashboardChatsRoutes(fastify, opts) {
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
  
      // ⚡ actualizar vidas antes de responder
      let creator = await prisma.creator.findUnique({ where: { id: dashboardId } });
      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }
      creator = await refillLives(creator);
  
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
      // Verificar que el chat exista
      let chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
      });

      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado" });
      }

      let updatedCreator;

      // ⚡ Si nunca se abrió, consumir vida
      if (!chat.isOpened) {
        try {
          updatedCreator = await consumeLife(dashboardId);
          chat = await prisma.chat.update({
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
        // Ya estaba abierto → no gastar vidas otra vez
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


  /**
   * Enviar mensaje como creador (NO gasta vidas)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      const { content } = req.body;

      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      if (!content || content.trim() === "") {
        return reply.code(400).send({ error: "El mensaje no puede estar vacío" });
      }

      // Validar chat
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
          creator: { select: { name: true } },
        },
      });

      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado" });
      }
      
      // Crear mensaje
      const msg = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "creator",
          content,
        },
      });

      reply.code(201).send({
        id: msg.id,
        from: msg.from,
        content: msg.content,
        createdAt: msg.createdAt,
      });
    } catch (err) {
      fastify.log.error("❌ Error en POST /dashboard/:dashboardId/chats/:chatId/messages:", err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });
}

module.exports = dashboardChatsRoutes;
