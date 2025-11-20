// routes/admin.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function adminRoutes(fastify, opts) {
  
  // A. CRON DE REEMBOLSOS (Lógica existente de 72h)
  fastify.post('/admin/check-refunds', { preHandler: [fastify.adminAuthenticate] }, async (req, reply) => {
      const timeLimitAgo = new Date(Date.now() - (72 * 60 * 60 * 1000)); // 72 horas
      try {
        const outdatedTips = await prisma.chatMessage.findMany({
          where: {
            tipStatus: 'PENDING',
            createdAt: { lt: timeLimitAgo },
            tipAmount: { gt: 0 }
          },
          select: { id: true, tipPaymentIntentId: true }
        });
        
        if (outdatedTips.length === 0) return reply.send({ success: true, count: 0, message: "Nada que reembolsar." });

        let refundedCount = 0;
        const successfulRefundIds = [];

        for (const tip of outdatedTips) {
          if (!tip.tipPaymentIntentId) continue;
          try {
            await stripe.refunds.create({ payment_intent: tip.tipPaymentIntentId });
            successfulRefundIds.push(tip.id);
            refundedCount++;
          } catch (refundError) {
            if (refundError.code === 'charge_already_refunded') successfulRefundIds.push(tip.id);
          }
        }

        if (successfulRefundIds.length > 0) {
            await prisma.chatMessage.updateMany({
                where: { id: { in: successfulRefundIds } },
                data: { tipStatus: 'NOT_FULFILLED' }
            });
        }
        
        reply.send({ success: true, count: successfulRefundIds.length, message: "Reembolsos procesados." });

      } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({ error: 'Error en cron reembolsos' });
      }
    }
  );

  // B. CRON DE REINTENTO DE PAGOS (NUEVO - PARA PAGOS EN COLA)
  fastify.post('/admin/retry-payments', { preHandler: [fastify.adminAuthenticate] }, async (req, reply) => {
      try {
          // Buscar pagos que quedaron esperando fondos
          const queue = await prisma.chatMessage.findMany({
            where: { tipStatus: 'PROCESSING' },
            include: { chat: { include: { creator: true } } }
          });

          if (queue.length === 0) return reply.send({ message: "La cola de pagos está vacía." });

          let processed = 0;
          let stillPending = 0;

          for (const msg of queue) {
              try {
                  if (!msg.tipPaymentIntentId || !msg.chat.creator.stripeAccountId) continue;

                  // Recuperar info fresca
                  const pi = await stripe.paymentIntents.retrieve(msg.tipPaymentIntentId);
                  
                  const creatorShare = (msg.tipAmount || 0) * 0.80; 
                  const amountCents = Math.round(creatorShare * 100);

                  // Reintentar transferencia
                  await stripe.transfers.create({
                      amount: amountCents,
                      currency: "mxn",
                      destination: msg.chat.creator.stripeAccountId,
                      transfer_group: pi.transfer_group,
                      description: `Respuesta GhostMessage (Reintento)`,
                  });

                  // Si funciona, actualizamos a FULFILLED
                  await prisma.chatMessage.update({
                      where: { id: msg.id },
                      data: { tipStatus: 'FULFILLED' }
                  });
                  processed++;

              } catch (err) {
                  if (err.code === 'balance_insufficient') {
                      stillPending++; // Sigue esperando al banco
                  } else {
                      console.error(`Error crítico en reintento ${msg.id}:`, err.message);
                  }
              }
          }

          reply.send({ 
              success: true, 
              processed, 
              still_waiting_funds: stillPending,
              message: `Procesados: ${processed}. Pendientes de fondos: ${stillPending}.` 
          });
      } catch (err) {
          fastify.log.error(err);
          reply.code(500).send({ error: 'Error en retry-payments' });
      }
  });
}

module.exports = adminRoutes;