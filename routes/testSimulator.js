// routes/testSimulator.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

module.exports = async function testSimulator(fastify, opts) {
  fastify.post("/test/simulate-approved-payment", async (req, reply) => {
    try {
      fastify.log.info("--- 🏁 INICIANDO SIMULACIÓN DE PAGO APROBADO (MÉTODO DIRECTO) ---");

      // 1. Crear un usuario de prueba
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

      // 2. Construir la notificación falsa
      const fakeNotification = {
        _simulation_metadata: {
            status: "approved",
            creator_id: creator.id
        }
      };
      fastify.log.info(`-> Notificación falsa construida. Inyectando en el webhook...`);

      // 3. Inyectar la petición directamente en el router de Fastify (Método a prueba de fallos)
      const response = await fastify.inject({
        method: 'POST',
        url: '/webhooks/mercadopago',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(fakeNotification)
      });
      
      if (response.statusCode !== 200) {
        throw new Error(`El webhook respondió con un error: ${response.statusCode} - ${response.body}`);
      }

      fastify.log.info(`-> Webhook ejecutado exitosamente vía inyección directa.`);

      // 4. Verificar el resultado en la BD
      const updatedCreator = await prisma.creator.findUnique({ where: { id: creator.id } });

      if (updatedCreator && updatedCreator.isPremium) {
        fastify.log.info(`--- ✅ ÉXITO DE LA SIMULACIÓN: El usuario ${creator.id} ahora es premium.`);
        return reply.send({ success: true, message: `Simulación exitosa. El usuario ${updatedCreator.email} ahora es Premium.` });
      } else {
        throw new Error("El webhook se ejecutó, pero no actualizó al usuario a premium. Revisa los logs del webhook.");
      }

    } catch (err) {
      fastify.log.error({ err }, "--- ❌ FALLO EN LA SIMULACIÓN ---");
      reply.code(500).send({ success: false, message: err.message });
    }
  });
};

