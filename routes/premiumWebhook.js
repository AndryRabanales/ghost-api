// routes/premiumWebhook.js
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const mp = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});

module.exports = async function premiumWebhook(fastify, opts) {
  fastify.post("/webhooks/mercadopago", async (req, reply) => {
    try {
      const notification = req.body;
      fastify.log.info({ notification }, "🔔 Notificación de Mercado Pago recibida");

      // Verificamos si es una notificación de suscripción (preapproval)
      if (notification.type === 'preapproval' && notification.data?.id) {
        // Aquí necesitaríamos ir a buscar los datos de la suscripción a la API de MP
        // para obtener el `external_reference` que es el `creatorId`.
        // Por ahora, como el link es estático, no podemos saber qué usuario pagó.
        // ESTA PARTE LA MEJORAREMOS LUEGO para hacerlo dinámico.
        fastify.log.warn("Notificación de suscripción recibida, pero el link es estático. No se puede asignar a un usuario.");

      } 
      // Mantenemos la lógica de pagos únicos por si la usamos en el futuro
      else if (notification.type === "payment" && notification.data?.id) {
        const paymentId = notification.data.id;
        const paymentClient = new Payment(mp);
        const payment = await paymentClient.get({ id: paymentId });

        if (payment.status === "approved" && payment.external_reference) {
          const creatorId = payment.external_reference;
          await prisma.creator.update({
            where: { id: creatorId },
            data: { isPremium: true, lives: 9999 },
          });
          fastify.log.info(`✅ Premium activado para creator ${creatorId} via pago único.`);
        }
      }

      reply.code(200).send({ ok: true });
    } catch (err) {
      fastify.log.error("❌ Error en webhook:", err);
      reply.code(500).send({ error: "Error en webhook" });
    }
  });
};