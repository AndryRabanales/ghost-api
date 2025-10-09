// routes/premiumWebhook.js
const { MercadoPagoConfig, Payment, PreApproval } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

// La función de validación de firma no cambia.
function validateSignature(req, secret) {
    // ... (el código de esta función se mantiene exactamente igual)
}

module.exports = async function premiumWebhook(fastify, opts) {
  fastify.post("/webhooks/mercadopago", async (req, reply) => {
    const notification = req.body;
    fastify.log.info({ notification }, "🔔 Notificación recibida en Webhook");

    try {
      const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
      // Para suscripciones, la validación de firma es aún más crítica.
      // Saltaremos la simulación por ahora para enfocarnos en el flujo real.
      if (!validateSignature(req, secret)) {
        fastify.log.warn("⚠️ Firma de Webhook inválida. Petición rechazada.");
        return reply.code(400).send({ error: "Firma inválida" });
      }
      fastify.log.info("✅ Firma de Webhook validada correctamente.");

      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      const client = new MercadoPagoConfig({ accessToken });

      // --- LÓGICA PARA MANEJAR SUSCRIPCIONES ---
      if (notification.type === 'subscription_preapproval') {
        const preapproval = new PreApproval(client);
        const subscriptionInfo = await preapproval.get({ id: notification.data.id });

        const creatorId = subscriptionInfo.external_reference;
        const subscriptionStatus = subscriptionInfo.status;
        const subscriptionId = subscriptionInfo.id;

        if (creatorId) {
          await prisma.creator.update({
            where: { id: creatorId },
            data: {
              isPremium: subscriptionStatus === 'authorized', // Es premium solo si está autorizada
              subscriptionStatus: subscriptionStatus,
              subscriptionId: subscriptionId,
            },
          });
          fastify.log.info(`✅ Estado de suscripción actualizado a '${subscriptionStatus}' para el creator ${creatorId}.`);
        }
      }

      // --- LÓGICA ANTIGUA PARA PAGOS ÚNICOS (la dejamos por si acaso) ---
      if (notification.type === 'payment') {
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: notification.data.id });
        
        if (paymentInfo.status === 'approved') {
          const creatorId = paymentInfo.metadata?.creator_id;
          if (creatorId) {
            await prisma.creator.update({
              where: { id: creatorId },
              data: { isPremium: true },
            });
            fastify.log.info(`✅ PREMIUM (pago único) activado para creator ${creatorId}.`);
          }
        }
      }

      reply.code(200).send({ ok: true });
    } catch (err) {
      fastify.log.error("❌ Error en webhook:", err);
      reply.code(500).send({ error: "Error procesando el webhook" });
    }
  });
};