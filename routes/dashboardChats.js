// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
// ❌ ANTES: const { refillLivesIfNeeded, minutesToNextLife, consumeLife } = require("../utils/lives");
// ✅ AHORA: Importa como objeto 'livesUtils' para evitar la desestructuración que puede fallar.
const livesUtils = require("../utils/lives"); 
const { sanitize } = require("../utils/sanitize"); 

// ... (dentro de async function dashboardChatsRoutes) ...

  /**
   * Enviar mensaje como creador (LIBERA FONDOS)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    // ... (lógica de mensaje sin cambios) ...

      // ... (Resto de la lógica de liberación de propina y actualización de lastActive) ...
      
      // La llamada a minutesToNextLife en la ruta GET también deberá ser actualizada a livesUtils.minutesToNextLife

    reply.code(201).send(msg);
  });

  // ... (ruta GET /dashboard/:dashboardId/chats/:chatId sin cambios, excepto llamadas) ...


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
        // ✅ CORRECCIÓN: Llamamos a la función a través del objeto importado
        updatedCreator = await livesUtils.consumeLife(dashboardId); 
        
        await prisma.chat.update({
          where: { id: chatId },
          data: { isOpened: true },
        });

      } else {
        updatedCreator = await prisma.creator.findUnique({ where: { id: dashboardId } });
        // ✅ CORRECCIÓN: Llamamos a la función a través del objeto importado
        updatedCreator = await livesUtils.refillLivesIfNeeded(updatedCreator); 
      }

      reply.send({
        ok: true,
        livesLeft: updatedCreator.lives, 
        // ✅ CORRECCIÓN: Llamamos a la función a través del objeto importado
        minutesToNextLife: livesUtils.minutesToNextLife(updatedCreator),
      });
      
    } catch (err) {
      fastify.log.error("❌ Error en POST /dashboard/:dashboardId/chats/:chatId/open:", err);
      // Aquí el error debe ser reportado con el error real si no es 500
      reply.code(500).send({ error: "Error abriendo chat" });
    }
  });
}

module.exports = dashboardChatsRoutes;