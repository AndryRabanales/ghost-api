// andryrabanales/ghost-api/ghost-api-ccf8c4209b8106a049818e3cd23d69e44883da4e/routes/creators.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
// ✅ CORRECCIÓN: Importación segura
const livesUtils = require('../utils/lives');
const { refillLivesIfNeeded, minutesToNextLife } = livesUtils;

async function creatorsRoutes(fastify, opts) {
  
  // ... (POST /creators y GET /creators/me siguen usando las funciones ya importadas) ...
  
  fastify.post("/creators", async (req, reply) => {
    // ... (rest of the route logic) ...
  });

  fastify.get("/creators/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      // ...
      const updated = await refillLivesIfNeeded(creator); // Usa la función corregida

      reply.send({
        // ... (rest of the data) ...
        minutesToNextLife: minutesToNextLife(updated), // Usa la función corregida
        isPremium: updated.isPremium,
      });
    } catch (err) {
      // ...
    }
  });
}

module.exports = creatorsRoutes;