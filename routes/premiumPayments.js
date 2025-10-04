// routes/premiumPayments.js
const { MercadoPagoConfig, Preference } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

// Inicializar Mercado Pago
const mp = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});

module.exports = async function premiumPayments(fastify, opts) {
  // Crear pago
  fastify.post(
    "/premium/create-payment",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const creatorId = req.user.id;
      const idempotencyKey = crypto.randomUUID();

      try {
        const preference = new Preference(mp);

        fastify.log.info(`Creando pago con BACKEND_URL: ${process.env.BACKEND_URL}`);

        const resMp = await preference.create({
          body: {
            items: [
              {
                title: `Suscripción Premium`,
                quantity: 1,
                currency_id: "MXN",
                unit_price: 100.0,
              },
            ],
            back_urls: {
              success: `${process.env.FRONTEND_URL}/payment/success`,
              failure: `${process.env.FRONTEND_URL}/payment/failure`,
              pending: `${process.env.FRONTEND_URL}/payment/pending`,
            },
            notification_url: `${process.env.BACKEND_URL}/webhooks/mercadopago`,
            external_reference: creatorId,
          },
        });

        await prisma.payment.create({
          data: {
            provider: "mercadopago",
            providerPaymentId: resMp.id?.toString(),
            creatorId,
            amount: 100.0,
            currency: "MXN",
            status: "PENDING",
            idempotencyKey,
            raw: resMp,
          },
        });

        return reply.send({
          ok: true,
          init_point: resMp.init_point,
        });

      } catch (err) {
        // --- ¡EL SOPLÓN! ---
        // Si Mercado Pago da un error, lo registraremos completo en los logs.
        fastify.log.error({
            message: "❌ Error creando la preferencia de pago en Mercado Pago",
            // 'err.cause' contiene la respuesta exacta de la API de Mercado Pago
            errorDetails: err.cause || err.message, 
        }, "Error detallado de Mercado Pago");

        return reply.code(500).send({ error: "Error creando la preferencia. Revisa los logs del servidor." });
      }
    }
  );
};