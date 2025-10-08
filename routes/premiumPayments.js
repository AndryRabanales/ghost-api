// routes/premiumPayments.js
const { MercadoPagoConfig, Preference } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

// ¡CORREGIDO AQUÍ! Se eliminó el "new" duplicado.
const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  // Esta ruta crea un pago único de prueba para activar Premium.
  fastify.post(
    "/premium/create-test-payment",
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
                title: "Activación Premium de Prueba",
                quantity: 1,
                unit_price: 10, // Precio de prueba
                currency_id: "MXN", // Asegúrate que esta sea tu moneda
              },
            ],
            // IMPORTANTE: Enviamos el ID del usuario para saber a quién activar Premium
            metadata: {
              creator_id: creator.id,
            },
            back_urls: {
              success: `${process.env.FRONTEND_URL}/payment-success`,
            },
            // IMPORTANTE: Esta URL le dice a Mercado Pago dónde notificar el pago
            notification_url: `${process.env.BACKEND_URL}/webhooks/mercadopago`,
          },
        };

        const result = await preference.create(preferenceData);
        
        fastify.log.info(`✅ Link de pago de prueba creado para creator ${creatorId}`);
        
        return reply.send({ ok: true, init_point: result.init_point });

      } catch (err) {
        const errorMessage = err.cause?.message || err.message;
        fastify.log.error({
            message: "❌ Error al crear la preferencia de pago de prueba",
            errorDetails: errorMessage,
        }, "Error en /premium/create-test-payment");
        return reply.code(500).send({ error: "Error al generar el link de pago", details: errorMessage });
      }
    }
  );
};

