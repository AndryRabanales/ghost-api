// routes/premiumPayments.js
const { MercadoPagoConfig, Preference } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      if (!accessToken) {
        return reply.code(500).send({ error: "Access Token de Mercado Pago no configurado." });
      }

      const creatorId = req.user.id;
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
      if (!creator || !creator.email) { // Asegurarnos que el creador tiene un email
        return reply.code(404).send({ error: "Usuario no encontrado o no tiene un email registrado." });
      }

      try {
        const client = new MercadoPagoConfig({ accessToken });
        const preference = new Preference(client);

        const preferenceData = {
          body: {
            items: [
              {
                title: "Activación Ghosty Premium",
                quantity: 1,
                unit_price: 5,
                currency_id: "MXN",
              },
            ],
            // --- SOLUCIÓN DEFINITIVA PARA EL BOTÓN BLOQUEADO ---
            // Creamos un objeto 'payer' súper completo para que Mercado Pago confíe en la transacción.
            payer: {
              name: creator.name || "Usuario",
              surname: "de Ghosty", // Un apellido genérico es aceptable
              email: creator.email, // Dato CRÍTICO: Usar el email real del usuario
              identification: {
                type: "RFC",
                number: "XAXX010101000" // RFC genérico para México (necesario para la estructura)
              }
            },
            // ---------------------------------------------------
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
        
        fastify.log.info(`✅ Link de pago creado para creator ${creatorId}`);
        
        return reply.send({ ok: true, init_point: result.init_point });

      } catch (err) {
        const errorMessage = err.cause?.message || err.message;
        fastify.log.error({
            message: "❌ Error al crear la preferencia de pago",
            errorDetails: errorMessage,
        }, "Error en /premium/create-subscription");
        return reply.code(500).send({ error: "Error al generar el link de pago", details: errorMessage });
      }
    }
  );
};