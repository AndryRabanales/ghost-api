// routes/premiumPayments.js
const { MercadoPagoConfig, PreApproval } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      // 1. OBTENER VARIABLES DE ENTORNO
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      const planId = process.env.MERCADOPAGO_PLAN_ID; 
      
      // 🔥 Nuevas variables OBLIGATORIAS para la Solución Definitiva
      const amount = process.env.MERCADOPAGO_SUBSCRIPTION_AMOUNT;
      const freq = process.env.MERCADOPAGO_SUBSCRIPTION_FREQUENCY;
      const freqType = process.env.MERCADOPAGO_SUBSCRIPTION_FREQUENCY_TYPE;
      const currency = process.env.MERCADOPAGO_SUBSCRIPTION_CURRENCY;

      if (!accessToken || !planId || !amount || !freq || !freqType || !currency) {
        return reply.code(500).send({ 
          error: "Error de configuración de Mercado Pago. Faltan variables de entorno.",
          details: "Asegúrate de que MERCADOPAGO_SUBSCRIPTION_AMOUNT, FREQUENCY, FREQUENCY_TYPE y CURRENCY estén definidos." 
        });
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
            // Se incluye el planId para referencia, aunque el esquema auto_recurring fuerza el flujo.
            preapproval_plan_id: planId, 
            reason: `Suscripción Premium Ghosty para ${creator.email}`,
            payer_email: creator.email,
            back_url: `${process.env.FRONTEND_URL}/dashboard/${creatorId}?subscription=success`,
            notification_url: `${process.env.BACKEND_URL}/webhooks/mercadopago`,
            external_reference: creator.id,
            
            // 🔥 SOLUCIÓN DEFINITIVA: Enviar esquema completo para anular el chequeo de card_token_id.
            auto_recurring: {
                frequency: parseInt(freq),
                frequency_type: freqType,
                transaction_amount: parseFloat(amount),
                currency_id: currency,
            },
          },
        };

        const result = await preapproval.create(subscriptionData);
        
        fastify.log.info(`✅ Link de SUSCRIPCIÓN creado para creator ${creatorId}`);
        
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