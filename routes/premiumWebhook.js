// routes/premiumWebhook.js
const { MercadoPagoConfig, PreApproval } = require("mercadopago"); // 👈 Se usa PreApproval para suscripciones
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto"); // 👈 Módulo de Node.js para criptografía

const prisma = new PrismaClient();

const mp = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});

// FUNCIÓN PARA VALIDAR LA FIRMA (LA MÁS IMPORTANTE)
function validateSignature(req, secret) {
  const signature = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];

  // Si no hay firma o clave secreta, la validación falla.
  if (!signature || !secret) {
    return false;
  }

  try {
    // 1. Separar timestamp (ts) y hash (v1) de la firma.
    const parts = signature.split(',').reduce((acc, part) => {
      const [key, value] = part.split('=');
      acc[key.trim()] = value.trim();
      return acc;
    }, {});

    const ts = parts.ts;
    const hash = parts.v1;

    // 2. Crear el "manifest" que Mercado Pago usó para firmar la notificación.
    const manifest = `id:${req.body.data.id};request-id:${requestId};ts:${ts};`;
    
    // 3. Crear nuestra propia firma usando la clave secreta.
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(manifest);
    const ourSignature = hmac.digest('hex');

    // 4. Comparar nuestra firma con la que envió Mercado Pago de forma segura.
    return crypto.timingSafeEqual(Buffer.from(ourSignature), Buffer.from(hash));
  } catch (e) {
    // Si algo falla en el proceso, la validación es negativa.
    return false;
  }
}

module.exports = async function premiumWebhook(fastify, opts) {
  fastify.post("/webhooks/mercadopago", async (req, reply) => {

    // 👇====== PASO 1: VALIDACIÓN DE SEGURIDAD ======👇
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!validateSignature(req, secret)) {
      fastify.log.warn("⚠️ Firma de Webhook inválida. Petición rechazada.");
      return reply.code(400).send({ error: "Firma inválida" });
    }
    fastify.log.info("✅ Firma de Webhook validada correctamente.");

    // 👇====== PASO 2: PROCESAR LA NOTIFICACIÓN SEGURA ======👇
    try {
      const notification = req.body;
      fastify.log.info({ notification }, "🔔 Notificación de MP recibida");

      // --- Lógica para Notificaciones de Suscripciones ('preapproval') ---
      if (notification.action === 'updated') {
          const subscriptionId = notification.data.id;
          const preApproval = new PreApproval(mp);
          const subscription = await preApproval.get({ id: subscriptionId });
          
          const creatorId = subscription.external_reference;
          
          if (subscription.status === 'authorized') {
              // La suscripción está activa (o se acaba de renovar)
              const expiresAt = new Date();
              // Asumimos que el plan es mensual, extendemos la expiración un mes
              expiresAt.setMonth(expiresAt.getMonth() + 1); 

              await prisma.creator.update({
                  where: { id: creatorId },
                  data: {
                      isPremium: true,
                      subscriptionId: subscription.id,
                      subscriptionStatus: 'active',
                      premiumExpiresAt: expiresAt,
                  },
              });
              fastify.log.info(`✅ Premium activado/renovado para creator ${creatorId}. Expira el: ${expiresAt.toISOString()}`);
          } else {
              // El estado cambió a pausado, cancelado, etc.
              await prisma.creator.update({
                  where: { id: creatorId },
                  data: {
                      isPremium: false,
                      subscriptionStatus: subscription.status,
                  },
              });
              fastify.log.warn(`⚠️ Premium desactivado para ${creatorId}. Estado: ${subscription.status}`);
          }
      }

      // Se responde 200 para que Mercado Pago sepa que recibimos la notificación.
      reply.code(200).send({ ok: true });
    } catch (err) {
      fastify.log.error("❌ Error en webhook:", err);
      reply.code(500).send({ error: "Error procesando el webhook" });
    }
  });
};