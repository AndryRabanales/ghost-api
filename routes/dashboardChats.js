// routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
// 👇 ESTA LÍNEA FALTABA: Importar Stripe para poder mover el dinero
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { sanitize } = require("../utils/sanitize"); 
const { analyzeMessage, analyzeCreatorResponse } = require("../utils/aiAnalyzer");

async function dashboardChatsRoutes(fastify, opts) {

  /**
   * Enviar mensaje como creador (AQUÍ ES DONDE PAGAMOS)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      const cleanContent = sanitize(req.body.content);

      if (req.user.id !== dashboardId) return reply.code(403).send({ error: "No autorizado" });

      // 1. Validación Básica (Sin fricción para MVP)
      const MIN_LENGTH = 2; 
      if (!cleanContent || cleanContent.trim().length < MIN_LENGTH) {
        return reply.code(400).send({ error: "Respuesta demasiado corta." });
      }

      // 2. Seguridad IA (Solo bloqueamos peligros reales)
      try {
        const safetyCheck = await analyzeMessage(cleanContent);
        if (!safetyCheck.isSafe) {
          return reply.code(400).send({ error: safetyCheck.reason || 'Bloqueado por seguridad.' });
        }
      } catch (aiError) {
        fastify.log.error(aiError, "Error IA (omitiendo)");
      }

      // 3. Guardar el mensaje en la base de datos
      const chat = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!chat || chat.creatorId !== dashboardId) return reply.code(404).send({ error: "Chat no encontrado" });
      
      const msg = await prisma.chatMessage.create({
        data: { chatId: chat.id, from: "creator", content: cleanContent },
      });

      // 4. 💸 LIBERACIÓN DE FONDOS (EL CÓDIGO QUE FALTABA) 💸
      const lastAnonTip = await prisma.chatMessage.findFirst({
        where: {
          chatId: chatId,
          from: 'anon',
          tipStatus: 'PENDING', // Solo pagamos si está pendiente
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, tipAmount: true } // Necesitamos saber CUÁNTO pagar
      });

      if (lastAnonTip && lastAnonTip.tipAmount > 0) {
        // Buscamos la cuenta de Stripe del creador
        const creatorData = await prisma.creator.findUnique({
            where: { id: dashboardId },
            select: { stripeAccountId: true }
        });

        if (creatorData && creatorData.stripeAccountId) {
            try {
                // A. Calcular el monto para el creador (80%)
                const grossAmount = lastAnonTip.tipAmount;
                const creatorShare = grossAmount * 0.80; 
                const amountCents = Math.round(creatorShare * 100);

                // B. ¡LA MAGIA! Transferir de TU saldo al SUYO
                await stripe.transfers.create({
                    amount: amountCents,
                    currency: "mxn",
                    destination: creatorData.stripeAccountId,
                    description: `Pago liberado: Respuesta a mensaje`,
                });

                fastify.log.info(`💸 ¡PAGO EXITOSO! Transferidos $${creatorShare} al creador.`);

                // C. Ahora sí, marcamos como pagado en la base de datos
                await prisma.chatMessage.update({
                  where: { id: lastAnonTip.id },
                  data: { tipStatus: 'FULFILLED' }
                });

            } catch (stripeErr) {
                fastify.log.error(`❌ Error crítico transfiriendo dinero: ${stripeErr.message}`);
                // No detenemos el mensaje, pero queda registro del error financiero
            }
        }
      }
      
      // Actualizar "Visto" y actividad
      if (chat.anonReplied) {
        await prisma.chat.update({ where: { id: chatId }, data: { anonReplied: false } });
      }
      await prisma.creator.update({ where: { id: dashboardId }, data: { lastActive: new Date() } });

      // Notificar en tiempo real
      const payload = { type: "message", ...msg };
      fastify.broadcastToChat(chat.id, payload);
      fastify.broadcastToDashboard(chat.creatorId, payload);

      reply.code(201).send(msg);
    } catch (err) {
      fastify.log.error("Error enviando mensaje:", err);
      reply.code(500).send({ error: "Error interno enviando mensaje" });
    }
  });

  /**
   * Obtener chat
   */
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

      // Marcar como leído al entrar
      if (chat.anonReplied) {
        await prisma.chat.update({ where: { id: chatId }, data: { anonReplied: false } });
      }

      // Calcular expiración (Lógica visual para el frontend)
      const lastAnonTip = await prisma.chatMessage.findFirst({
        where: { chatId: chatId, from: 'anon', tipStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, tipAmount: true }
      });
      
      let tipExpiresInMinutes = null;
      
      if (lastAnonTip && lastAnonTip.tipAmount > 0) {
          const now = new Date();
          const tipCreatedAt = new Date(lastAnonTip.createdAt);
          const expirationTime = 72 * 60 * 60 * 1000; // 72 Horas
          const timeLeftMs = expirationTime - (now.getTime() - tipCreatedAt.getTime());
          
          tipExpiresInMinutes = timeLeftMs > 0 ? Math.ceil(timeLeftMs / (1000 * 60)) : 0;
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
        })),
        tipExpiresInMinutes: tipExpiresInMinutes,
      });
    } catch (err) {
      fastify.log.error("Error obteniendo chat:", err);
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });

  /**
   * Abrir chat (Estado visual)
   */
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