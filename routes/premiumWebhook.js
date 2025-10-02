// routes/premiumWebhook.js
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Inicializar SDK
const mp = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});

module.exports = async function premiumWebhook(fastify, opts) {
  fastify.post("/webhooks/mercadopago", async (req, reply) => {
    try {
      const data = req.body;

      // Mercado Pago manda diferentes tipos: "payment", "plan", etc.
      if (data.type === "payment" && data.data?.id) {
        const paymentId = data.data.id;

        // ⚡ Usar SDK v2 para consultar pago
        const paymentClient = new Payment(mp);
        const payment = await paymentClient.get({ id: paymentId });

        if (payment.status === "approved") {
          const creatorId = payment.external_reference;

          await prisma.creator.update({
            where: { id: creatorId },
            data: { isPremium: true, lives: 9999 },
          });

          fastify.log.info(`✅ Premium activado para creator ${creatorId}`);

          // Actualizamos tabla de pagos
          await prisma.payment.updateMany({
            where: { providerPaymentId: paymentId.toString() },
            data: { status: "APPROVED", raw: payment },
          });
        }
      }

      reply.send({ ok: true });
    } catch (err) {
      fastify.log.error("❌ Error en webhook:", err);
      reply.code(500).send({ error: "Error en webhook" });
    }
  });
};
