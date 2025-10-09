// routes/testSimulator.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const bcrypt = require("bcrypt");

module.exports = async function testSimulator(fastify, opts) {
  fastify.post("/test/simulate-approved-payment", async (req, reply) => {
    try {
      fastify.log.info("--- 🏁 INICIANDO SIMULACIÓN DE PAGO APROBADO ---");

      const testEmail = `simulation-${Date.now()}@ghosty.com`;
      const hashedPassword = await bcrypt.hash("123", 10);

      const creator = await prisma.creator.create({
        data: {
          id: crypto.randomUUID(),
          publicId: crypto.randomUUID(),
          name: "Usuario Simulado",
          email: testEmail,
          password: hashedPassword,
        },
      });
      fastify.log.info(`-> Usuario de prueba creado con contraseña: ${creator.id}`);

      const fakeNotification = {
        _simulation_metadata: {
            status: "approved",
            creator_id: creator.id
        }
      };

      const response = await fastify.inject({
        method: 'POST',
        url: '/webhooks/mercadopago',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(fakeNotification)
      });
      
      if (response.statusCode !== 200) {
        throw new Error(`El webhook respondió con un error: ${response.statusCode} - ${response.body}`);
      }

      const updatedCreator = await prisma.creator.findUnique({ where: { id: creator.id } });

      if (updatedCreator && updatedCreator.isPremium) {
        return reply.send({ success: true, message: `¡Éxito! Inicia sesión con: Email: ${updatedCreator.email} | Contraseña: 123` });
      } else {
        throw new Error("El webhook se ejecutó, pero no actualizó al usuario a premium.");
      }

    } catch (err) {
      fastify.log.error({ err }, "--- ❌ FALLO EN LA SIMULACIÓN ---");
      reply.code(500).send({ success: false, message: err.message });
    }
  });

  fastify.get("/test/verify-status/:email", async (req, reply) => {
    try {
        const { email } = req.params;
        const creator = await prisma.creator.findUnique({ where: { email } });

        if (!creator) {
            return reply.code(404).send({ error: "Usuario no encontrado" });
        }

        reply.send({
            email: creator.email,
            isPremium: creator.isPremium,
            lives: creator.lives,
            subscriptionStatus: creator.subscriptionStatus,
            premiumExpiresAt: creator.premiumExpiresAt, // Devolver la fecha de expiración
            createdAt: creator.createdAt
        });
    } catch (err) {
        reply.code(500).send({ error: "Error al consultar el usuario" });
    }
  });
};