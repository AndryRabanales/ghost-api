// andryrabanales/ghost-api/ghost-api-ccf8c44883da4e/routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ✅ CORRECCIÓN: Importación segura de lives.js
const livesUtils = require("../utils/lives");
const { refillLivesIfNeeded, minutesToNextLife, consumeLife } = livesUtils; 

const { sanitize } = require("../utils/sanitize"); 

async function dashboardChatsRoutes(fastify, opts) {

  // ... (Las rutas usan ahora minutesToNextLife, consumeLife y refillLivesIfNeeded) ...

  /**
   * Enviar mensaje como creador (LIBERA FONDOS)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    // ... (El código de la ruta 'messages' se mantiene, usando las funciones desestructuradas) ...
  });

  // ... (La ruta GET /dashboard/:dashboardId/chats/:chatId se mantiene) ...
  
  /**
   * Abrir un chat (Asegura vidas ilimitadas para todos)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/open", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    // ... (El código de la ruta 'open' se mantiene, usando las funciones desestructuradas) ...
  });
}

module.exports = dashboardChatsRoutes;