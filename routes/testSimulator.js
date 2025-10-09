// routes/testSimulator.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const fetch = require("node-fetch"); // Asegúrate de tener node-fetch si usas una versión de Node < 18

module.exports = async function testSimulator(fastify, opts) {
  fastify.post("/test/simulate-approved-payment", async (req, reply) => {
    try {
      fastify.log.info("--- 🏁 INICIANDO SIMULACIÓN DE PAGO APROBADO ---");

      // 1. Crear un usuario de prueba para la simulación
      const testEmail = `simulation-${Date.now()}@ghosty.com`;
      const creator = await prisma.creator.create({
        data: {
          id: crypto.randomUUID(),
          publicId: crypto.randomUUID(),
          name: "Usuario Simulado",
          email: testEmail,
        },
      });
      fastify.log.info(`-> Usuario de prueba creado: ${creator.id}`);

      // 2. Construir una notificación FALSA de Mercado Pago que nuestro webhook entenderá
      const fakeNotification = {
        type: "payment",
        action: "payment.created",
        data: {
          id: `SIM-${Date.now()}`, // Un ID de pago simulado
        },
        // ¡LA MAGIA!: Enviamos los datos que necesitamos directamente.
        _simulation_metadata: {
            status: "approved",
            creator_id: creator.id
        }
      };
      fastify.log.info(`-> Notificación falsa construida para el webhook.`);

      // 3. Llamar a nuestro propio webhook para probar la lógica
      const webhookUrl = `${process.env.BACKEND_URL}/webhooks/mercadopago`;
      const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fakeNotification)
      });

      if (!response.ok) {
          throw new Error(`El webhook respondió con un error: ${response.statusText}`);
      }

      fastify.log.info(`-> Webhook ejecutado exitosamente.`);

      // 4. Verificar que el usuario es premium en la base de datos
      const updatedCreator = await prisma.creator.findUnique({ where: { id: creator.id } });

      if (updatedCreator.isPremium) {
        fastify.log.info(`--- ✅ ÉXITO DE LA SIMULACIÓN: El usuario ${creator.id} ahora es premium.`);
        return reply.send({ success: true, message: `Simulación exitosa. El usuario ${updatedCreator.email} ahora es Premium.` });
      } else {
        throw new Error("El webhook se ejecutó, pero no actualizó al usuario a premium.");
      }

    } catch (err) {
      fastify.log.error("--- ❌ FALLO EN LA SIMULACIÓN ---", err);
      reply.code(500).send({ success: false, message: err.message });
    }
  });
};
