// routes/premiumPayments.js
const { MercadoPagoConfig, PreApproval } = require("mercadopado");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      // --- LOGS DE DIAGNÓSTICO ---
      fastify.log.info("--- INICIANDO /premium/create-subscription ---");
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      const planId = process.env.MERCADOPAGO_PLAN_ID;
      const frontendUrl = process.env.FRONTEND_URL;
      
      fastify.log.info({
        accessToken: accessToken ? `Presente (inicia con ${accessToken.substring(0, 8)})` : "NO PRESENTE",
        planId: planId || "NO PRESENTE",
        frontendUrl: frontendUrl || "NO PRESENTE (usando fallback)",
        userId: req.user.id
      }, "Variables de entorno y usuario:");
      // --- FIN DE LOGS ---

      if (!accessToken) {
        fastify.log.error("❌ TOKEN DE ACCESO DE MERCADO PAGO NO CONFIGURADO.");
        return reply.code(500).send({ error: "Error de configuración: Falta el Access Token." });
      }

      if (!planId) {
        fastify.log.error("❌ MERCADOPAGO_PLAN_ID no está configurado.");
        return reply.code(500).send({ error: "Error de configuración del servidor (Plan ID)." });
      }
      
      const creatorId = req.user.id;
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
      if (!creator || !creator.email) {
        return reply.code(404).send({ error: "Usuario no encontrado o sin email registrado." });
      }

      try {
        const client = new MercadoPagoConfig({ accessToken });
        const preApproval = new PreApproval(client);

        // --- ESTRUCTURA CORRECTA PARA LA SUSCRIPCIÓN ---
        const subscriptionData = {
          preapproval_plan_id: planId,
          reason: `Suscripción Premium para ${creator.name || creator.email}`,
          payer_email: creator.email, 
          back_url: `${frontendUrl || 'http://localhost:3000'}/payment-success`,
        };
        
        fastify.log.info({ payload: subscriptionData }, "Enviando estos datos a Mercado Pago:");

        const result = await preApproval.create({ body: subscriptionData });
        
        fastify.log.info({ mpResponse: result }, "✅ Respuesta exitosa de Mercado Pago:");
        
        return reply.send({ ok: true, init_point: result.init_point });

      } catch (err) {
        const fullError = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
        fastify.log.error({
            message: "❌ Error DETALLADO al crear la preferencia de suscripción",
            fullErrorObject: fullError
        }, "Error en create-subscription (CAPTURA COMPLETA)");

        const errorMessage = err.cause?.message || err.message;
        return reply.code(500).send({ error: "Error al generar el link de pago", details: errorMessage });
      }
    }
  );
};
