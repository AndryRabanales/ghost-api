// routes/premiumWebhook.js
const { MercadoPagoConfig, PreApproval } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

const mp = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});

function validateSignature(req, secret) {
    // ... (esta función se queda igual)
    const signature = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    if (!signature || !secret) return false;
    try {
        const parts = signature.split(',').reduce((acc, part) => {
            const [key, value] = part.split('=');
            acc[key.trim()] = value.trim();
            return acc;
        }, {});
        const ts = parts.ts;
        const hash = parts.v1;
        const manifest = `id:${req.body.data.id};request-id:${requestId};ts:${ts};`;
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(manifest);
        const ourSignature = hmac.digest('hex');
        return crypto.timingSafeEqual(Buffer.from(ourSignature), Buffer.from(hash));
    } catch (e) {
        return false;
    }
}

module.exports = async function premiumWebhook(fastify, opts) {
  fastify.post("/webhooks/mercadopago", async (req, reply) => {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!validateSignature(req, secret)) {
      fastify.log.warn("⚠️ Firma de Webhook inválida. Petición rechazada.");
      return reply.code(400).send({ error: "Firma inválida" });
    }
    fastify.log.info("✅ Firma de Webhook validada correctamente.");

    try {
      const notification = req.body;
      fastify.log.info({ notification }, "🔔 Notificación de MP recibida");

      if (notification.action === 'updated') {
          const subscriptionId = notification.data.id;
          const preApproval = new PreApproval(mp);
          const subscription = await preApproval.get({ id: subscriptionId });
          
          // --- ✨ LÓGICA DE BÚSQUEDA POR EMAIL ✨ ---
          const payerEmail = subscription.payer_email;
          if (!payerEmail) {
              fastify.log.error(`Webhook para suscripción ${subscriptionId} no tiene email del pagador.`);
              return reply.code(400).send({ error: "Falta email del pagador" });
          }

          const creator = await prisma.creator.findUnique({
              where: { email: payerEmail }
          });

          if (!creator) {
              fastify.log.error(`No se encontró un creador con el email: ${payerEmail}`);
              return reply.code(404).send({ error: "Creador no encontrado" });
          }
          // ---------------------------------------------
          
          if (subscription.status === 'authorized') {
              const expiresAt = new Date();
              expiresAt.setMonth(expiresAt.getMonth() + 1); 

              await prisma.creator.update({
                  where: { id: creator.id }, // Usamos el ID del creador encontrado
                  data: {
                      isPremium: true,
                      subscriptionId: subscription.id,
                      subscriptionStatus: 'active',
                      premiumExpiresAt: expiresAt,
                  },
              });
              fastify.log.info(`✅ Premium activado/renovado para creator ${creator.id}. Expira el: ${expiresAt.toISOString()}`);
          } else {
              await prisma.creator.update({
                  where: { id: creator.id }, // Usamos el ID del creador encontrado
                  data: {
                      isPremium: false,
                      subscriptionStatus: subscription.status,
                  },
              });
              fastify.log.warn(`⚠️ Premium desactivado para ${creator.id}. Estado: ${subscription.status}`);
          }
      }

      reply.code(200).send({ ok: true });
    } catch (err) {
      fastify.log.error("❌ Error en webhook:", err);
      reply.code(500).send({ error: "Error procesando el webhook" });
    }
  });
};