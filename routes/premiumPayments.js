// routes/premiumPayments.js
const { MercadoPagoConfig } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const creatorId = req.user.id;
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });

      if (!creator) {
        return reply.code(404).send({ error: "Usuario no encontrado" });
      }
      
      const planId = process.env.MERCADOPAGO_PLAN_ID;
      if (!planId) {
          fastify.log.error("❌ MERCADOPAGO_PLAN_ID no está configurado en las variables de entorno.");
          return reply.code(500).send({ error: "Error de configuración del servidor." });
      }

      // --- ✨ SOLUCIÓN DIRECTA: CONSTRUIR EL LINK MANUALMENTE ✨ ---
      try {
        // En lugar de llamar a la API de MP para crear un link, lo construimos nosotros.
        // Esto asume que el plan ya tiene todo configurado.
        const checkoutUrl = `https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_plan_id=${planId}`;
        
        // Es crucial que el plan en Mercado Pago tenga la "Referencia externa" configurada
        // para que el webhook funcione. Por ahora, asociamos el plan al usuario en nuestra DB.
        await prisma.creator.update({
            where: { id: creatorId },
            data: { subscriptionId: planId } // Guardamos el ID del plan como referencia inicial
        });

        fastify.log.info(`✅ Link de checkout directo generado para creator ${creatorId}`);
        
        // Devolvemos el link construido manualmente.
        return reply.send({ ok: true, init_point: checkoutUrl });

      } catch (err) {
        fastify.log.error({
            message: "❌ Error en la ruta de suscripción directa",
            errorDetails: err.message, 
        }, "Error en create-subscription");

        return reply.code(500).send({ error: "Error al generar el link de pago" });
      }
    }
  );
};