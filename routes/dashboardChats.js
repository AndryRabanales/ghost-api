// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function dashboardChatsRoutes(fastify, opts) {
  /**
   * Obtener todos los mensajes de un chat (lado creador)
   */
  fastify.get("/dashboard/:dashboardId/chats/:chatId", async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;

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
        anonAlias: chat.anonAlias, // 👈 devolver alias fijo
        messages: chat.messages.map((m) => ({
          id: m.id,
          from: m.from,
          alias: m.alias || chat.anonAlias || "Anónimo",
          content: m.content,
          createdAt: m.createdAt,
        })),
      });
      
    } catch (err) {
      fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats/:chatId:", err);
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });

  /**
   * Enviar mensaje como creador
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      const { content } = req.body;

      if (!content || content.trim() === "") {
        return reply.code(400).send({ error: "El mensaje no puede estar vacío" });
      }

      // Validar chat
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
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
