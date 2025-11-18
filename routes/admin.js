// routes/admin.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
// --- 👇 1. IMPORTAR STRIPE 👇 ---
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function adminRoutes(fastify, opts) {
  
  fastify.post(
    '/admin/check-refunds',
    { preHandler: [fastify.adminAuthenticate] }, 
    async (req, reply) => {

      // --- 👇 2. USAR UN TIEMPO REAL (72 HORAS) 👇 ---
      // 7 segundos es para pruebas locales, 72h es para producción.
      // const timeLimitAgo = new Date(Date.now() - (7 * 1000)); // 7 segundos (para pruebas)
      const timeLimitAgo = new Date(Date.now() - (72 * 60 * 60 * 1000)); // 72 horas

      try {
        const outdatedTips = await prisma.chatMessage.findMany({
          where: {
            tipStatus: 'PENDING',
            createdAt: {
              lt: timeLimitAgo, // Creado antes del límite
            },
            tipAmount: {
                gt: 0 
            }
          },
          // --- 👇 3. PEDIR EL ID DE PAGO 👇 ---
          select: {
            id: true,
            tipPaymentIntentId: true // <--- ¡Crítico para el reembolso!
          }
        });
        
        if (outdatedTips.length === 0) {
            fastify.log.info("Cron: No se encontraron pagos expirados para reembolsar.");
            return reply.send({ success: true, count: 0, message: "No se encontraron pagos pendientes de reembolso." });
        }

        // --- 👇 4. LÓGICA DE REEMBOLSO EN BUCLE 👇 ---
        
        let refundedCount = 0;
        const successfulRefundIds = []; // IDs de *mensajes* (UUIDs)

        fastify.log.warn(`Cron: Iniciando reembolsos para ${outdatedTips.length} pago(s).`);

        for (const tip of outdatedTips) {
          if (!tip.tipPaymentIntentId) {
            fastify.log.error(`Pago ${tip.id} no tiene payment_intent_id. Omitiendo reembolso.`);
            continue;
          }

          try {
            // 1. Llamar a Stripe para ejecutar el reembolso
            await stripe.refunds.create({
              payment_intent: tip.tipPaymentIntentId,
            });

            // 2. Si tiene éxito, añadirlo a la lista para actualizar DB
            successfulRefundIds.push(tip.id);
            refundedCount++;
            fastify.log.info(`Cron: Reembolso exitoso para ${tip.tipPaymentIntentId}`);
          
          } catch (refundError) {
            fastify.log.error(refundError, `Cron: Falló el reembolso para ${tip.tipPaymentIntentId}.`);
            // Si el error es "ya ha sido reembolsado", lo marcamos como NOT_FULFILLED
            if (refundError.code === 'charge_already_refunded') {
              successfulRefundIds.push(tip.id);
            }
            // Otros errores (ej. "payment_intent_unknown") se ignoran y se reintentarán la próxima vez
          }
        }

        if (successfulRefundIds.length === 0) {
            fastify.log.warn("Cron: No se completó ningún reembolso en este ciclo.");
            return reply.send({ success: true, count: 0, message: "No se pudo completar ningún reembolso en este ciclo." });
        }

        // 3. Actualizar la base de datos SÓLO para los reembolsos exitosos
        const updateResult = await prisma.chatMessage.updateMany({
            where: {
                id: { in: successfulRefundIds }
            },
            data: {
                tipStatus: 'NOT_FULFILLED', // <--- Marcar como No Cumplido
            }
        });
        
        fastify.log.warn(`Cron: ✅ ${updateResult.count} pago(s) marcado(s) como NOT_FULFILLED (Reembolsado).`);
        
        reply.send({ 
            success: true, 
            count: updateResult.count, 
            message: `Reembolso procesado para ${updateResult.count} pago(s).`
        });

      } catch (err) {
        fastify.log.error(err, "Error al ejecutar el cron de reembolsos");
        reply.code(500).send({ error: 'Error interno en el cron job' });
      }
    }
  );
}

module.exports = adminRoutes;