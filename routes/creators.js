// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
// ✅ CORRECCIÓN: Importamos las funciones de lives desde el util
const { refillLivesIfNeeded, minutesToNextLife } = require('../utils/lives');


async function creatorsRoutes(fastify, opts) {
  // ... (ruta POST /creators sin cambios) ...

  // ... (ruta GET /creators/me) ...
  fastify.get("/creators/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      // ... (lógica de expiración de premium sin cambios) ...

      // ✅ CORRECCIÓN: Usamos las funciones importadas
      const updated = await refillLivesIfNeeded(creator);

      reply.send({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        publicId: updated.publicId,
        lives: updated.lives,
        maxLives: updated.maxLives,
        // ✅ CORRECCIÓN: Usamos la función importada
        minutesToNextLife: minutesToNextLife(updated), 
        isPremium: updated.isPremium,
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });

  // ... (ruta GET /dashboard/:dashboardId/chats sin cambios) ...
}

module.exports = creatorsRoutes;