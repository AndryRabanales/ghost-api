// routes/premiumPayments.js
const { MercadoPagoConfig, Preference } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

// ⚡ Inicializar Mercado Pago con config nueva
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
      const { plan = "premium_monthly", amount = 100.0 } = req.body; // puedes ajustar planes

      // idempotency
      const idempotencyKey = crypto.randomUUID();

      try {
        // 1. Crear preference con SDK v2
        const preference = new Preference(mp);

        const resMp = await preference.create({
          body: {
            items: [
              {
                title: `Upgrade ${plan}`,
                quantity: 1,
                currency_id: "MXN", // ⚠️ ajusta moneda, antes tenías "ARS"
                unit_price: Number(amount),
              },
            ],
            back_urls: {
              success: process.env.FRONTEND_URL + "/payment/success",
              failure: process.env.FRONTEND_URL + "/payment/failure",
              pending: process.env.FRONTEND_URL + "/payment/pending",
            },
            notification_url: `${process.env.BACKEND_URL}/webhooks/mercadopago`,
            external_reference: creatorId,
          },
        });

        // 2. Guardar transacción PENDING
        await prisma.payment.create({
          data: {
            provider: "mercadopago",
            providerPaymentId: resMp.id?.toString(),
            creatorId,
            amount: Number(amount),
            currency: "MXN",
            status: "PENDING",
            idempotencyKey,
            raw: resMp, // guardar todo el objeto preference
          },
        });

        return reply.send({
          ok: true,
          init_point: resMp.init_point,
          preference: resMp,
        });
      } catch (err) {
        fastify.log.error("❌ Error creando preferencia", err);
        return reply.code(500).send({ error: "Error creando preferencia" });
      }
    }
  );
};
