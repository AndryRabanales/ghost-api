// routes/premiumPayments.js
const { MercadoPagoConfig, PreApproval } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      
      if (!accessToken) {
        fastify.log.error("❌ TOKEN DE ACCESO DE MERCADO PAGO NO CONFIGURADO.");
        return reply.code(500).send({ error: "Error de configuración: Falta el Access Token." });
      }

      const planId = process.env.MERCADOPAGO_PLAN_ID;
      if (!planId) {
        fastify.log.error("❌ MERCADOPAGO_PLAN_ID no está configurado.");
        return reply.code(500).send({ error: "Error de configuración del servidor (Plan ID)." });
      }
      
      const creatorId = req.user.id;
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
      if (!creator || !creator.email) {
        return reply.code(404).send({ error: "Usuario no encontrado o sin email registrado." });
      }

      try {
        const client = new MercadoPagoConfig({ accessToken });
        const preApproval = new PreApproval(client);

        const subscriptionData = {
          preapproval_plan_id: planId,
          reason: `Suscripción Premium para ${creator.name || creator.email}`, // Motivo de la suscripción
          payer_email: creator.email, 
          // --- SOLUCIÓN FINAL ---
          // Usamos 'back_url' (singular) en lugar de 'back_urls' (plural).
          // Esta es la URL a la que el usuario volverá después del pago.
          back_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success`,
        };

        const result = await preApproval.create({ body: subscriptionData });
        
        fastify.log.info(`✅ Preferencia de suscripción creada para creator ${creatorId}`);
        
        return reply.send({ ok: true, init_point: result.init_point });

      } catch (err) {
        const errorMessage = err.cause?.message || err.message;
        fastify.log.error({
            message: "❌ Error al crear la preferencia de suscripción",
            errorDetails: errorMessage, 
        }, "Error en create-subscription");

        return reply.code(500).send({ error: "Error al generar el link de pago", details: errorMessage });
      }
    }
  );
};
