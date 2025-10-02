// routes/premium.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function premiumRoutes(fastify, opts) {
  // Activar Premium (simula pago exitoso)
  fastify.post("/premium/activate", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      const creatorId = req.user.id;

      const updated = await prisma.creator.update({
        where: { id: creatorId },
        data: {
          isPremium: true,
          lives: 9999, // opcional: para mostrar que es ilimitado
        },
      });

      return reply.send({ ok: true, message: "Premium activado ✅", creator: updated });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: "Error activando premium" });
    }
  });

  // Desactivar Premium (para pruebas)
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

      return reply.send({ ok: true, message: "Premium desactivado ❌", creator: updated });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: "Error desactivando premium" });
    }
  });
}

module.exports = premiumRoutes;
