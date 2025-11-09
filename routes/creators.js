// andryrabanales/ghost-api/ghost-api-ccf8c4209b8106a049818e3cd23d69e44883da4e/routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

// ✅ CORRECCIÓN: Importación como objeto único para máxima estabilidad
const livesUtils = require('../utils/lives'); 

async function creatorsRoutes(fastify, opts) {

  // ... (ruta POST /creators sin cambios) ...

  /**
   * Obtener datos del usuario autenticado (con chequeo de expiración de premium)
   */
  fastify.get("/creators/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      // ... (lógica de autenticación y expiración de premium) ...

      // ✅ Usamos la función a través del objeto importado
      const updated = await livesUtils.refillLivesIfNeeded(creator);

      reply.send({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        publicId: updated.publicId,
        lives: updated.lives,
        maxLives: updated.maxLives,
        // ✅ Usamos la función a través del objeto importado
        minutesToNextLife: livesUtils.minutesToNextLife(updated), 
        isPremium: updated.isPremium,
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });

  // ... (el resto de las rutas se mantiene) ...
}

module.exports = creatorsRoutes;