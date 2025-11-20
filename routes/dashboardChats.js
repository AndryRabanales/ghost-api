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
      
      const msg = await prisma.chatMessage.create({
        data: { chatId: chat.id, from: "creator", content: cleanContent },
      });

      // 💸 LIBERACIÓN DE FONDOS CORREGIDA (CON SOURCE_TRANSACTION) 💸
      const lastAnonTip = await prisma.chatMessage.findFirst({
        where: { chatId: chatId, from: 'anon', tipStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, tipAmount: true, tipPaymentIntentId: true } // IMPORTANTE: Necesitamos el PaymentIntentId
      });

      if (lastAnonTip && lastAnonTip.tipAmount > 0 && lastAnonTip.tipPaymentIntentId) {
        const creatorData = await prisma.creator.findUnique({
            where: { id: dashboardId },
            select: { stripeAccountId: true }
        });

        if (creatorData && creatorData.stripeAccountId) {
            try {
                // 1. RECUPERAR LA CARGA ORIGINAL (CHARGE ID)
                // Necesitamos el ID de la "Charge" (ch_...), no el "PaymentIntent" (pi_...), 
                // para usarlo como source_transaction.
                const paymentIntent = await stripe.paymentIntents.retrieve(lastAnonTip.tipPaymentIntentId);
                const chargeId = paymentIntent.latest_charge;

                // 2. CALCULAR MONTO (80%)
                const creatorShare = lastAnonTip.tipAmount * 0.80; 
                const amountCents = Math.round(creatorShare * 100);

                // 3. TRANSFERIR ATANDO LOS FONDOS
                await stripe.transfers.create({
                    amount: amountCents,
                    currency: "mxn",
                    destination: creatorData.stripeAccountId,
                    // 👇 LA MAGIA: Esto permite transferir fondos pendientes
                    source_transaction: chargeId, 
                    description: `Pago liberado: Respuesta a mensaje`,
                });

                fastify.log.info(`💸 PAGO EXITOSO: Transferidos $${creatorShare} usando source ${chargeId}`);

                await prisma.chatMessage.update({
                  where: { id: lastAnonTip.id },
                  data: { tipStatus: 'FULFILLED' }
                });

            } catch (stripeErr) {
                fastify.log.error(`❌ Error crítico transfiriendo dinero: ${stripeErr.message}`);
                // Aquí podrías guardar un flag de "error_pago" en la DB para reintentar luego
            }
        }
      }
      
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

  // (El resto de las rutas GET y OPEN se mantienen igual que antes...)
  // 2. OBTENER CHAT
  fastify.get("/dashboard/:dashboardId/chats/:chatId", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    // ... (Código estándar de lectura que ya tenías)
    try {
        const { dashboardId, chatId } = req.params;
        if (req.user.id !== dashboardId) return reply.code(403).send({ error: "No autorizado" });
        let chat = await prisma.chat.findFirst({
          where: { id: chatId, creatorId: dashboardId },
          include: { messages: { orderBy: { createdAt: "asc" } } },
        });
        if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });
        if (chat.anonReplied) await prisma.chat.update({ where: { id: chatId }, data: { anonReplied: false } });
        
        // Calculo expiración simple
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