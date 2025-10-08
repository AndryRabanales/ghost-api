// routes/premiumPayments.js
const { MercadoPagoConfig } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      if (!accessToken) {
        fastify.log.error("❌ MERCADOPAGO_ACCESS_TOKEN no está configurado.");
        return reply.code(500).send({ error: "Error de configuración del servidor (Access Token)." });
      }

      const planId = process.env.MERCADOPAGO_PLAN_ID;
      if (!planId) {
          fastify.log.error("❌ MERCADOPAGO_PLAN_ID no está configurado.");
          return reply.code(500).send({ error: "Error de configuración del servidor (Plan ID)." });
      }

      const creatorId = req.user.id;
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
      if (!creator) {
        return reply.code(404).send({ error: "Usuario no encontrado" });
      }

      try {
        // Simplemente generamos la URL y la enviamos.
        // El ID de la suscripción real se guardará en el webhook DESPUÉS del pago.
        const checkoutUrl = `https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_plan_id=${planId}`;
        
        fastify.log.info(`✅ Link de checkout directo generado para creator ${creatorId}`);
        
        // Ya no actualizamos la base de datos aquí. ¡Este era el error!
        return reply.send({ ok: true, init_point: checkoutUrl });

      } catch (err) {
        fastify.log.error({
            message: "❌ Error en la ruta de suscripción directa",
            errorDetails: err.message, 
        }, "Error en create-subscription");

        return reply.code(500).send({ error: "Error al generar el link de pago" });
      }
    }
  );
};
