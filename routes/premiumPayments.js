// routes/premiumPayments.js
const { MercadoPagoConfig, PreApproval } = require("mercadopago"); // Importamos PreApproval en lugar de Preference
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      const planId = process.env.MERCADOPAGO_PLAN_ID; // Leemos el ID del plan desde las variables

      if (!accessToken || !planId) {
        return reply.code(500).send({ error: "Access Token o Plan ID de Mercado Pago no configurado." });
      }

      const creatorId = req.user.id;
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });

      if (!creator || !creator.email) {
        return reply.code(404).send({ error: "Usuario no encontrado o no tiene un email registrado." });
      }

      try {
        const client = new MercadoPagoConfig({ accessToken });
        const preapproval = new PreApproval(client);

        const subscriptionData = {
          body: {
            preapproval_plan_id: planId,
            reason: `Suscripción Premium Ghosty para ${creator.email}`,
            payer_email: creator.email,
            back_url: `${process.env.FRONTEND_URL}/dashboard/${creatorId}?subscription=success`,
            // La notification_url ya está configurada en tu panel de MP, pero la enviamos por si acaso.
            notification_url: `${process.env.BACKEND_URL}/webhooks/mercadopago`,
            external_reference: creator.id, // ¡MUY IMPORTANTE! Así sabemos qué usuario se suscribió.
            
            // SOLUCIÓN PARA EL ERROR 'card_token_id is required'
            auto_recurring: {
                frequency: 1,
                frequency_type: "months",
                transaction_amount: 1, // Placeholder, el monto real viene del plan.
                currency_id: "MXN",    // Ajusta la moneda si es diferente (e.g., "ARS", "CLP")
            },
            // FIN DE LA SOLUCIÓN
          },
        };

        const result = await preapproval.create(subscriptionData);
        
        fastify.log.info(`✅ Link de SUSCRIPCIÓN creado para creator ${creatorId}`);
        
        // El link para iniciar la suscripción está en init_point
        return reply.send({ ok: true, init_point: result.init_point });

      } catch (err) {
        const errorMessage = err.cause?.message || err.message;
        fastify.log.error({
            message: "❌ Error al crear la suscripción",
            errorDetails: errorMessage,
        }, "Error en /premium/create-subscription");
        return reply.code(500).send({ error: "Error al generar el link de suscripción", details: errorMessage });
      }
    }
  );
};