// routes/admin.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function adminRoutes(fastify, opts) {

  fastify.post(
    '/admin/check-refunds',
    // SOLO accesible con la API Key de Admin
    { preHandler: [fastify.adminAuthenticate] },
    async (req, reply) => {

      return reply.send({ success: true, count: 0, message: "No se encontraron pagos pendientes de reembolso." });
    }
  );
}

module.exports = adminRoutes;