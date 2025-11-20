// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sanitize } = require("../utils/sanitize"); 
const { analyzeMessage } = require("../utils/aiAnalyzer");

async function dashboardChatsRoutes(fastify, opts) {

  // ENVIAR RESPUESTA Y LIBERAR FONDOS
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      const cleanContent = sanitize(req.body.content);

      if (req.user.id !== dashboardId) return reply.code(403).send({ error: "No autorizado" });

      const MIN_LENGTH = 2; 
      if (!cleanContent || cleanContent.trim().length < MIN_LENGTH) {
        return reply.code(400).send({ error: "Respuesta demasiado corta." });
      }

      // Análisis IA
      try {
        const safetyCheck = await analyzeMessage(cleanContent);
        if (!safetyCheck.isSafe) {
          return reply.code(400).send({ error: safetyCheck.reason || 'Bloqueado por seguridad.' });
        }
      } catch (aiError) {
        fastify.log.error(aiError);
      }

      const chat = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!chat || chat.creatorId !== dashboardId) return reply.code(404).send({ error: "Chat no encontrado" });
      
      // 1. Crear el mensaje de respuesta PRIMERO
      const msg = await prisma.chatMessage.create({
        data: { chatId: chat.id, from: "creator", content: cleanContent },
      });

      // 💸 2. LIBERACIÓN DE FONDOS (CORREGIDA) 💸
      const lastAnonTip = await prisma.chatMessage.findFirst({
        where: { chatId: chatId, from: 'anon', tipStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, tipAmount: true, tipPaymentIntentId: true }
      });

      if (lastAnonTip && lastAnonTip.tipAmount > 0 && lastAnonTip.tipPaymentIntentId) {
        const creatorData = await prisma.creator.findUnique({
            where: { id: dashboardId },
            select: { stripeAccountId: true }
        });

        if (creatorData && creatorData.stripeAccountId) {
            try {
                // Recuperamos el PaymentIntent para obtener el transfer_group (si existe)
                const paymentIntent = await stripe.paymentIntents.retrieve(lastAnonTip.tipPaymentIntentId);
                
                // COMISIÓN DE PLATAFORMA (Ej: 20%)
                const creatorShare = lastAnonTip.tipAmount * 0.80; 
                const amountCents = Math.round(creatorShare * 100);

                // 👇 TRANSFERENCIA SIMPLE (Sin source_transaction)
                // Esto mueve dinero de TU saldo de plataforma a la cuenta conectada.
                // Requiere que tu plataforma tenga saldo disponible o que el cobro original ya esté disponible.
                const transferConfig = {
                    amount: amountCents,
                    currency: "mxn",
                    destination: creatorData.stripeAccountId,
                    description: `Pago liberado: Respuesta a mensaje (Chat ${chatId.substring(0,8)})`,
                };

                // Si guardamos el grupo en public.js, lo usamos aquí para trazabilidad
                if (paymentIntent.transfer_group) {
                    transferConfig.transfer_group = paymentIntent.transfer_group;
                }

                await stripe.transfers.create(transferConfig);

                fastify.log.info(`💸 PAGO LIBERADO: Transferidos $${creatorShare} a ${creatorData.stripeAccountId}`);

                // Actualizar estado en DB a 'FULFILLED'
                await prisma.chatMessage.update({
                  where: { id: lastAnonTip.id },
                  data: { tipStatus: 'FULFILLED' }
                });

            } catch (stripeErr) {
                fastify.log.error(`❌ Error transfiriendo dinero: ${stripeErr.message}`);
                // IMPORTANTE: No fallamos la request completa si falla el pago,
                // el mensaje ya se creó. Podrías guardar un flag "error_pago" para reintentar manualmente.
                if (stripeErr.code === 'balance_insufficient') {
                     fastify.log.warn("⚠️ Saldo insuficiente en plataforma para transferir inmediatamente.");
                }
            }
        }
      }
      
      // Actualizar estado del chat
      if (chat.anonReplied) {
        await prisma.chat.update({ where: { id: chatId }, data: { anonReplied: false } });
      }
      await prisma.creator.update({ where: { id: dashboardId }, data: { lastActive: new Date() } });

      const payload = { type: "message", ...msg };
      fastify.broadcastToChat(chat.id, payload);
      fastify.broadcastToDashboard(chat.creatorId, payload);

      reply.code(201).send(msg);
    } catch (err) {
      fastify.log.error("Error enviando mensaje:", err);
      reply.code(500).send({ error: "Error interno enviando mensaje" });
    }
  });

  // ... (Las demás rutas GET y POST open se quedan igual) ...
  // 2. OBTENER CHAT
    fastify.get("/dashboard/:dashboardId/chats/:chatId", {
      preHandler: [fastify.authenticate],
    }, async (req, reply) => {
      try {
          const { dashboardId, chatId } = req.params;
          if (req.user.id !== dashboardId) return reply.code(403).send({ error: "No autorizado" });
          let chat = await prisma.chat.findFirst({
            where: { id: chatId, creatorId: dashboardId },
            include: { messages: { orderBy: { createdAt: "asc" } } },
          });
          if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });
          if (chat.anonReplied) await prisma.chat.update({ where: { id: chatId }, data: { anonReplied: false } });
          
          let tipExpiresInMinutes = null;
          const lastAnonTip = await prisma.chatMessage.findFirst({
              where: { chatId: chatId, from: 'anon', tipStatus: 'PENDING' },
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true, tipAmount: true }
          });
          if (lastAnonTip && lastAnonTip.tipAmount > 0) {
              const timeLeftMs = (72 * 60 * 60 * 1000) - (new Date().getTime() - new Date(lastAnonTip.createdAt).getTime());
              tipExpiresInMinutes = timeLeftMs > 0 ? Math.ceil(timeLeftMs / 60000) : 0;
          }

          reply.send({
            id: chat.id,
            anonToken: chat.anonToken,
            anonAlias: chat.anonAlias, 
            messages: chat.messages.map(m => ({
              id: m.id, from: m.from, content: m.content, createdAt: m.createdAt,
              tipAmount: m.tipAmount, tipStatus: m.tipStatus, alias: m.alias || chat.anonAlias || "Anónimo"
            })),
            tipExpiresInMinutes
          });
      } catch (err) { reply.code(500).send({ error: "Error" }); }
    });

    // 3. ABRIR CHAT
    fastify.post("/dashboard/:dashboardId/chats/:chatId/open", {
      preHandler: [fastify.authenticate],
    }, async (req, reply) => {
        try {
          await prisma.chat.update({ where: { id: req.params.chatId }, data: { isOpened: true } });
          reply.send({ ok: true });
        } catch (e) { reply.code(500).send({ error: "Error" }); }
    });
}

module.exports = dashboardChatsRoutes;