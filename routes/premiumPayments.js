// routes/premiumPayments.js
const { MercadoPagoConfig, PreApproval } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function premiumPayments(fastify, opts) {
  fastify.post(
    "/premium/create-subscription",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      
      if (!accessToken) {
        return reply.code(500).send({ 
          error: "Error de configuración: Falta MERCADOPAGO_ACCESS_TOKEN."
        });
      }

      const creatorId = req.user.id;
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });

      if (!creator || !creator.email) {
        return reply.code(404).send({ error: "Usuario no encontrado o sin email registrado." });
      }

      try {
        const client = new MercadoPagoConfig({ accessToken });
        const preapproval = new PreApproval(client);

        // --- NUEVA ESTRATEGIA: Crear suscripción sin Plan ID ---
        // Le pasamos directamente los detalles del cobro.
        const subscriptionData = {
          body: {
            reason: "Suscripción Premium Ghosty", // Nombre que verá el usuario
            payer_email: creator.email,
            back_url: `${process.env.FRONTEND_URL}/dashboard/${creatorId}?subscription=success`,
            external_reference: creator.id,
            auto_recurring: {
              frequency: 1,
              frequency_type: "months",
              transaction_amount: 69.0, // El monto que quieres cobrar
              currency_id: "MXN",      // La moneda
            },
            // Se elimina 'preapproval_plan_id' para forzar este método
          },
        };

        fastify.log.info(subscriptionData.body, "DEBUG: Creando suscripción sin plan_id");

        const result = await preapproval.create(subscriptionData);
        
        fastify.log.info(`✅ Link de SUSCRIPCIÓN (sin plan) creado para creator ${creatorId}`);
        
        return reply.send({ ok: true, init_point: result.init_point });

      } catch (err) {
        const errorMessage = err.cause?.message || err.message;
        fastify.log.error({
            message: "❌ Error al crear la suscripción (método sin plan)",
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