// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { refillLives, minutesToNextLife, consumeLife } = require("../utils/lives");

async function dashboardChatsRoutes(fastify, opts) {
  /**
   * Obtener todos los mensajes de un chat (lado creador)
   */
  fastify.get("/dashboard/:dashboardId/chats/:chatId", async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;

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
   * Enviar mensaje como creador
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/open", async (req, reply) => {
    const { dashboardId, chatId } = req.params;
  
    try {
      // ⚡ Consumir vida
      let updatedCreator;
      try {
        updatedCreator = await consumeLife(dashboardId);
      } catch (err) {
        const creator = await prisma.creator.findUnique({ where: { id: dashboardId } });
        return reply.code(403).send({
          error: err.message,
          minutesToNextLife: minutesToNextLife(creator),
          livesLeft: creator?.lives ?? 0,
        });
      }
  
      // Validar que el chat exista
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
      });
      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado" });
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
