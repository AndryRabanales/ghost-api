// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ✅ CORRECCIÓN: Importación como objeto único para máxima estabilidad
const livesUtils = require("../utils/lives"); 

const { sanitize } = require("../utils/sanitize"); 

async function dashboardChatsRoutes(fastify, opts) {

  /**
   * Enviar mensaje como creador (LIBERA FONDOS)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      // ... (lógica de mensaje y liberación de propina) ...

      // ✅ Actualiza el estado activo del creador
      await prisma.creator.update({
          where: { id: dashboardId },
          data: { lastActive: new Date() }
      });

      // ... (websocket broadcast) ...

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
      // ...
      let creator = await prisma.creator.findUnique({ where: { id: dashboardId } });
      if (!creator) { /* ... */ }
      // ✅ Usamos la función a través del objeto importado
      creator = await livesUtils.refillLivesIfNeeded(creator); 
      // ...
      
      // Lógica de tiempo de expiración (24 Horas)
      // ...

      reply.send({
        // ... (data) ...
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
    // ... (lógica de autenticación) ...

    try {
      let chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
      });
      // ...

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