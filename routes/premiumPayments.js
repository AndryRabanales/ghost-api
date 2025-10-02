// routes/premiumPayments.js
const mercadopago = require("mercadopago");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  mercadopago.configure({ access_token: process.env.MERCADOPAGO_ACCESS_TOKEN });

  fastify.post("/premium/create-payment", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const creatorId = req.user.id;
    const { plan = "premium_monthly", amount = 100.0 } = req.body; // ajusta planes

    // idempotency
    const idempotencyKey = crypto.randomUUID();

    try {
      // 1. crea preference
      const preference = {
        items: [{ title: `Upgrade ${plan}`, quantity: 1, currency_id: "ARS", unit_price: Number(amount) }],
        back_urls: {
          success: process.env.FRONTEND_URL + "/payment/success",
          failure: process.env.FRONTEND_URL + "/payment/failure",
          pending: process.env.FRONTEND_URL + "/payment/pending",
        },
        notification_url: `${process.env.BACKEND_URL}/webhooks/mercadopago`,
        external_reference: creatorId,
      };

      const resMp = await mercadopago.preferences.create(preference);

      // 2. guardar transacción PENDING
      await prisma.payment.create({
        data: {
          provider: "mercadopago",
          providerPaymentId: resMp.body.id?.toString(),
          creatorId,
          amount: Number(amount),
          currency: "ARS",
          status: "PENDING",
          idempotencyKey,
          raw: resMp.body,
        },
      });

      return reply.send({ ok: true, init_point: resMp.body.init_point, preference: resMp.body });
    } catch (err) {
      fastify.log.error("Error creating preference", err);
      return reply.code(500).send({ error: "Error creando preferencia" });
    }
  });
};
