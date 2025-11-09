// andryrabanales/ghost-api/ghost-api-ccf8c4209b8106a049818e3cd23d69e44883da4e/routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ✅ CORRECCIÓN: Importación segura de lives.js
const livesUtils = require("../utils/lives");
const { refillLivesIfNeeded, minutesToNextLife, consumeLife } = livesUtils; 

const { sanitize } = require("../utils/sanitize"); 

async function dashboardChatsRoutes(fastify, opts) {
  
  // ... (rutas 'messages' y 'chats/:chatId' usan las funciones corregidas) ...

  /**
   * Abrir un chat (Fijado: Evita fallos de 'consumeLife' y 'minutesToNextLife')
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/open", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    // ... (omitted logic) ...
    try {
      // ...
      let updatedCreator;

      if (!chat.isOpened) {
        // Usa la función corregida
        updatedCreator = await consumeLife(dashboardId);
        await prisma.chat.update({
          where: { id: chatId },
          data: { isOpened: true },
        });
      } else {
        updatedCreator = await prisma.creator.findUnique({ where: { id: dashboardId } });
        // Usa la función corregida
        updatedCreator = await refillLivesIfNeeded(updatedCreator); 
      }

      reply.send({
        ok: true,
        livesLeft: updatedCreator.lives,
        // Usa la función corregida
        minutesToNextLife: minutesToNextLife(updatedCreator), 
      });
    } catch (err) {
      fastify.log.error("❌ Error en POST /dashboard/:dashboardId/chats/:chatId/open:", err);
      reply.code(500).send({ error: "Error abriendo chat" });
    }
  });
}

module.exports = dashboardChatsRoutes;