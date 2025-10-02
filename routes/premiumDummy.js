// routes/premiumDummy.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function premiumDummyRoutes(fastify, opts) {
  // Activar Premium (simulación)
  fastify.post("/premium/activate", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      const creatorId = req.user.id;

      const updated = await prisma.creator.update({
        where: { id: creatorId },
        data: {
          isPremium: true,
          lives: 9999, // para simular vidas ilimitadas
        },
      });

      return reply.send({
        ok: true,
        message: "✅ Premium activado (dummy)",
        creator: updated,
      });
    } catch (err) {
      fastify.log.error("❌ Error en /premium/activate:", err);
      return reply.code(500).send({ error: "Error activando premium" });
    }
  });

  // Desactivar Premium (simulación)
  fastify.post("/premium/deactivate", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      const creatorId = req.user.id;

      const updated = await prisma.creator.update({
        where: { id: creatorId },
        data: {
          isPremium: false,
          lives: 6,
          maxLives: 6,
        },
      });

      return reply.send({
        ok: true,
        message: "❌ Premium desactivado (dummy)",
        creator: updated,
      });
    } catch (err) {
      fastify.log.error("❌ Error en /premium/deactivate:", err);
      return reply.code(500).send({ error: "Error desactivando premium" });
    }
  });
}

module.exports = premiumDummyRoutes;
