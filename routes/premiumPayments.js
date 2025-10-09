// routes/premiumPayments.js
const { MercadoPagoConfig, Preference } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-test-payment", // Usaremos esta ruta para la prueba de pago único
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      if (!accessToken) {
        return reply.code(500).send({ error: "Access Token de Mercado Pago no configurado." });
      }

      const creatorId = req.user.id;
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
      if (!creator) {
        return reply.code(404).send({ error: "Usuario no encontrado." });
      }

      try {
        const client = new MercadoPagoConfig({ accessToken });
        const preference = new Preference(client);

        const preferenceData = {
          body: {
            items: [
              {
                title: "Activación Premium de Prueba (Real)",
                quantity: 1,
                unit_price: 5, // <-- ¡CAMBIO IMPORTANTE AQUÍ! Precio mínimo para la prueba.
                currency_id: "MXN",
              },
            ],
            payer: {
              name: creator.name || "Usuario",
              surname: "de Ghosty",
              email: creator.email,
              identification: {
                type: "RFC",
                number: "XAXX010101000"
              }
            },
            metadata: {
              creator_id: creator.id,
            },
            back_urls: {
              success: `${process.env.FRONTEND_URL}/dashboard/${creatorId}?payment=success`,
            },
            notification_url: `${process.env.BACKEND_URL}/webhooks/mercadopago`,
          },
        };

        const result = await preference.create(preferenceData);
        
        fastify.log.info(`✅ Link de pago REAL de prueba creado para creator ${creatorId}`);
        
        return reply.send({ ok: true, init_point: result.init_point });

      } catch (err) {
        const errorMessage = err.cause?.message || err.message;
        fastify.log.error({
            message: "❌ Error al crear la preferencia de pago de prueba real",
            errorDetails: errorMessage,
        }, "Error en /premium/create-test-payment");
        return reply.code(500).send({ error: "Error al generar el link de pago", details: errorMessage });
      }
    }
  );
};