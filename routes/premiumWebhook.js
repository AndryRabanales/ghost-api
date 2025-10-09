// routes/premiumWebhook.js
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

// Esta función de seguridad se queda igual.
function validateSignature(req, secret) {
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
    const notification = req.body;
    fastify.log.info({ notification }, "🔔 Notificación recibida en Webhook");

    try {
      // --- LA SOLUCIÓN: LA LISTA DE INVITADOS ---
      // Si la notificación viene de nuestro simulador, la dejamos pasar primero.
      if (notification && notification._simulation_metadata) {
        fastify.log.info("-> Detectada notificación de simulación. Saltando validación de firma.");
        const { status, creator_id } = notification._simulation_metadata;

        if (status === 'approved' && creator_id) {
          await prisma.creator.update({
            where: { id: creator_id },
            data: { isPremium: true, subscriptionStatus: 'active-simulation' },
          });
          fastify.log.info(`✅ PREMIUM (SIMULADO) ACTIVADO para creator ${creator_id}.`);
        }
        return reply.code(200).send({ ok: true, source: 'simulation' });
      }
      
      // --- LÓGICA NORMAL (EL GUARDIA HACE SU TRABAJO) ---
      // Si no es una simulación, entonces sí validamos la firma de Mercado Pago.
      const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
      if (!validateSignature(req, secret)) {
        fastify.log.warn("⚠️ Firma de Webhook real inválida. Petición rechazada.");
        return reply.code(400).send({ error: "Firma inválida" });
      }
      fastify.log.info("✅ Firma de Webhook real validada correctamente.");

      // Si la firma es válida, procesamos el pago real...
      if (notification && notification.type === 'payment') {
        const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
        const client = new MercadoPagoConfig({ accessToken });
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: notification.data.id });
        
        if (paymentInfo.status === 'approved') {
          const creatorId = paymentInfo.metadata?.creator_id;
          if (creatorId) {
            await prisma.creator.update({
              where: { id: creatorId },
              data: { isPremium: true, subscriptionStatus: 'active' },
            });
            fastify.log.info(`✅ PREMIUM (REAL) ACTIVADO para creator ${creatorId}.`);
          }
        }
      }

      reply.code(200).send({ ok: true, source: 'real' });
    } catch (err) {
      fastify.log.error("❌ Error en webhook:", err);
      reply.code(500).send({ error: "Error procesando el webhook" });
    }
  });
};

