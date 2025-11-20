// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Necesario para transferir
const { sanitize } = require("../utils/sanitize"); 
const { analyzeMessage } = require("../utils/aiAnalyzer");

async function dashboardChatsRoutes(fastify, opts) {

  // 1. RESPONDER Y COBRAR (LIBERACIÓN DE FONDOS)
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      const cleanContent = sanitize(req.body.content);

      if (req.user.id !== dashboardId) return reply.code(403).send({ error: "No autorizado" });

      // Validación básica
      if (!cleanContent || cleanContent.trim().length < 2) {
        return reply.code(400).send({ error: "Respuesta vacía." });
      }

      // Seguridad IA (Solo bloquea lo peligroso)
      try {
        const safetyCheck = await analyzeMessage(cleanContent);
        if (!safetyCheck.isSafe) {
          return reply.code(400).send({ error: safetyCheck.reason || 'Bloqueado por seguridad.' });
        }
      } catch (aiError) {
        fastify.log.error(aiError);
      }

      // Guardar mensaje en DB
      const chat = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });
      
      const msg = await prisma.chatMessage.create({
        data: { chatId: chat.id, from: "creator", content: cleanContent },
      });

      // 💸 LÓGICA DE LIBERACIÓN DE DINERO (ESCROW) 💸
      const lastAnonTip = await prisma.chatMessage.findFirst({
        where: { chatId: chatId, from: 'anon', tipStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, tipAmount: true } 
      });

      if (lastAnonTip && lastAnonTip.tipAmount > 0) {
        const creatorData = await prisma.creator.findUnique({
            where: { id: dashboardId },
            select: { stripeAccountId: true }
        });

        if (creatorData && creatorData.stripeAccountId) {
            try {
                // 1. Calcular el 80% para el creador
                const creatorShare = lastAnonTip.tipAmount * 0.80; 
                const amountCents = Math.round(creatorShare * 100);

                // 2. Transferir de TU cuenta a la SUYA
                await stripe.transfers.create({
                    amount: amountCents,
                    currency: "mxn",
                    destination: creatorData.stripeAccountId,
                    description: `Pago liberado: Chat ${chatId.substring(0,8)}`,
                });

                fastify.log.info(`💸 Pagados $${creatorShare} al creador ${dashboardId}`);

                // 3. Marcar como pagado
                await prisma.chatMessage.update({
                  where: { id: lastAnonTip.id },
                  data: { tipStatus: 'FULFILLED' }
                });

            } catch (stripeErr) {
                fastify.log.error(`Error transferencia: ${stripeErr.message}`);
                // No fallamos la request, pero queda registro. El creador reclamará si no llega.
            }
        }
      }
      
      // Actualizar actividad y notificar
      await prisma.creator.update({ where: { id: dashboardId }, data: { lastActive: new Date() } });
      const payload = { type: "message", ...msg };
      fastify.broadcastToChat(chat.id, payload);
      fastify.broadcastToDashboard(chat.creatorId, payload);

      reply.code(201).send(msg);

    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });

  // 2. OBTENER CHAT (LECTURA)
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
        
      if (chat.anonReplied) {
        await prisma.chat.update({ where: { id: chatId }, data: { anonReplied: false } });
      }
  
      reply.send({
        id: chat.id,
        anonToken: chat.anonToken,
        anonAlias: chat.anonAlias, 
        messages: chat.messages.map((m) => ({
          id: m.id,
          from: m.from,
          alias: m.alias || chat.anonAlias || "Anónimo",
          content: m.content,
          createdAt: m.createdAt,
          tipAmount: m.tipAmount,
          tipStatus: m.tipStatus,
        }))
      });
    } catch (err) {
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });

  // 3. ABRIR CHAT
  fastify.post("/dashboard/:dashboardId/chats/:chatId/open", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const { dashboardId, chatId } = req.params;
    if (req.user.id !== dashboardId) return reply.code(403).send({ error: "No autorizado" });
    try {
      await prisma.chat.update({ where: { id: chatId }, data: { isOpened: true } });
      reply.send({ ok: true });
    } catch (err) {
      reply.code(500).send({ error: "Error" });
    }
  });
}

module.exports = dashboardChatsRoutes;