// routes/premiumPayments.js
const { MercadoPagoConfig, PreApproval } = require("mercadopago"); // 👈 Cambiamos a PreApproval para suscripciones
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const mp = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription", // 👈 Nombramos la ruta para que sea más clara
    { preHandler: [fastify.authenticate] }, // Protegemos la ruta, solo usuarios logueados pueden suscribirse
    async (req, reply) => {
      const creatorId = req.user.id;
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });

      if (!creator) {
        return reply.code(404).send({ error: "Usuario no encontrado" });
      }

      // Validar que el plan ID esté configurado
      if (!process.env.MERCADOPAGO_PLAN_ID) {
          fastify.log.error("❌ MERCADOPAGO_PLAN_ID no está configurado en las variables de entorno.");
          return reply.code(500).send({ error: "Error de configuración del servidor." });
      }

      try {
        const preApproval = new PreApproval(mp);
        const response = await preApproval.create({
          body: {
            preapproval_plan_id: process.env.MERCADOPAGO_PLAN_ID,
            reason: `Suscripción Premium para ${creator.name}`,
            external_reference: creatorId, // ✅ Vinculamos la suscripción al ID de tu usuario
            payer_email: creator.email, // Usamos el email del usuario para una mejor experiencia
            back_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}`, // A dónde volverá el usuario tras el pago
          },
        });

        fastify.log.info(`✅ Link de suscripción generado para creator ${creatorId}`);
        
        // Devolvemos el link de pago (init_point) al frontend
        return reply.send({ ok: true, init_point: response.init_point });

      } catch (err) {
        fastify.log.error({
            message: "❌ Error creando la suscripción en Mercado Pago",
            errorDetails: err.cause || err.message, 
        }, "Error detallado de Mercado Pago");

        return reply.code(500).send({ error: "Error al contactar con el proveedor de pagos" });
      }
    }
  );
};