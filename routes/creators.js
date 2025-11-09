// andryrabanales/ghost-api/ghost-api-ccf8c4209b8106a049818e3cd23d69e44883da4e/routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

// ✅ CORRECCIÓN: Importación segura de lives.js
const livesUtils = require('../utils/lives');
const { refillLivesIfNeeded, minutesToNextLife } = livesUtils;

async function creatorsRoutes(fastify, opts) {
  
  /**
   * Ruta: POST /creators (Crear un nuevo espacio)
   */
  fastify.post("/creators", async (req, reply) => {
    // ... (El código de la ruta 'creators' se mantiene) ...
  });

  /**
   * Ruta: GET /creators/me (Obtener datos del usuario, incluyendo vidas)
   */
  fastify.get("/creators/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      // ... (lógica de autenticación y expiración de premium) ...
      
      let creator = null;
      if (req.user.id && req.user.id !== "null") {
        creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
      } else if (req.user.publicId && req.user.publicId !== "null") {
        creator = await prisma.creator.findUnique({ where: { publicId: req.user.publicId } });
      }
      if (!creator) {
        return reply.code(404).send({ error: "Creator no encontrado" });
      }

      // Lógica de expiración de premium (sin cambios)
      // ...
 
      // ✅ Usa la función corregida
      const updated = await refillLivesIfNeeded(creator);

      reply.send({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        publicId: updated.publicId,
        lives: updated.lives,
        maxLives: updated.maxLives,
        // ✅ Usa la función corregida
        minutesToNextLife: minutesToNextLife(updated),
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