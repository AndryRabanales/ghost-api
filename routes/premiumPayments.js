// routes/premiumPayments.js
const { MercadoPagoConfig, PreApproval } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      // OBTENER VARIABLES DE ENTORNO CRÍTICAS
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      const planId = process.env.MERCADOPAGO_PLAN_ID;
      
      // VERIFICACIÓN DE VARIABLES CRÍTICAS
      if (!accessToken || !planId) {
        fastify.log.error("Faltan MERCADOPAGO_ACCESS_TOKEN o MERCADOPAGO_PLAN_ID en las variables de entorno.");
        return reply.code(500).send({ 
          error: "Error de configuración CRÍTICA de Mercado Pago.",
          details: "MERCADOPAGO_ACCESS_TOKEN y MERCADOPAGO_PLAN_ID deben estar definidos en .env" 
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
            preapproval_plan_id: planId,
            reason: `Suscripción Premium Ghosty para ${creator.email}`,
            payer_email: creator.email,
            back_url: `${process.env.FRONTEND_URL}/dashboard/${creatorId}?subscription=success`,
            notification_url: `${process.env.BACKEND_URL}/webhooks/mercadopago`,
            external_reference: creator.id,
          
            // 🔥 VERIFICACIÓN FINAL DE DATOS 🔥
            auto_recurring: {
                frequency: 1,
                frequency_type: "months",
                transaction_amount: 69.0, // <-- Corregido al monto de tu plan
                currency_id: "MXN",      // <-- Corregido a la moneda de tu plan
            },
          },
        };

        // =================================================================
        // LÍNEA DE DEPURACIÓN PARA VERIFICAR LOS DATOS ANTES DE ENVIAR
        // =================================================================
        fastify.log.info({
            message: "Enviando estos datos a Mercado Pago...",
            planId: planId,
            subscriptionBody: subscriptionData.body
        }, "DATOS DE SUSCRIPCIÓN");
        // =================================================================

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
        return reply.code(500).send({ 
            error: "Error al generar el link de suscripción.", 
            details: errorMessage 
        });
      }
    }
  );
};