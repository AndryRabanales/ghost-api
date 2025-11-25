// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require("crypto"); 
const { sanitize } = require("../utils/sanitize");
const { analyzeMessage } = require("../utils/aiAnalyzer");

async function publicRoutes(fastify, opts) {

  // 1. OBTENER PERFIL PÚBLICO
  fastify.get("/public/creator/:publicId", async (req, reply) => {
    const { publicId } = req.params;
    const creator = await prisma.creator.findUnique({ where: { publicId } });
    if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Contar mensajes REALES pagados hoy
    const msgCountToday = await prisma.chatMessage.count({
      where: {
        chat: { creatorId: creator.id },
        createdAt: { gte: startOfDay },
        from: 'anon',
        // Solo contamos los que ya se pagaron o están pendientes de liberar
        tipStatus: { in: ['FULFILLED', 'PENDING'] } 
      }
    });

    const DAILY_LIMIT = creator.dailyMsgLimit || 30; 
    const isFull = msgCountToday >= DAILY_LIMIT;

    reply.send({
      creatorName: creator.name,
      baseTipAmountCents: creator.baseTipAmountCents,
      topicPreference: creator.topicPreference,
      // Enviamos el objeto escasezData con el conteo real
      escasezData: { msgCountToday, dailyMsgLimit: DAILY_LIMIT },
      isFull
    });
  });

  // 2. CREAR SESIÓN DE PAGO (MODO ESCROW INTELIGENTE)
  fastify.post("/public/:publicId/create-checkout-session", async (req, reply) => {
    const { publicId } = req.params;
    const { content, alias, fanEmail, tipAmount } = req.body; 

    const creator = await prisma.creator.findUnique({ where: { publicId } });
    if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });

    // --- 🔒 BLOQUEO DE LÍMITE DIARIO (CANDADO REAL) ---
    const DAILY_LIMIT = creator.dailyMsgLimit || 30;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const msgCountToday = await prisma.chatMessage.count({
      where: {
        chat: { creatorId: creator.id },
        createdAt: { gte: startOfDay },
        from: 'anon',
        tipStatus: { in: ['FULFILLED', 'PENDING'] }
      }
    });

    if (msgCountToday >= DAILY_LIMIT) {
        return reply.code(400).send({ 
            error: "⛔ El creador ha alcanzado su límite diario de mensajes. Intenta mañana." 
        });
    }
    // --- 🔒 FIN BLOQUEO ---

    // 🟢 CAMBIO: Validación de mínimo $20 MXN
    if (!tipAmount || tipAmount < 20) {
        return reply.code(400).send({ error: "El monto mínimo es $20 MXN" });
    }

    const cleanContent = sanitize(content);
    
    // Validación IA
    try {
        const safetyCheck = await analyzeMessage(cleanContent, creator.topicPreference);
        if (!safetyCheck.isSafe) {
            return reply.code(400).send({ error: safetyCheck.reason || "Mensaje bloqueado." });
        }
    } catch (aiError) {
        fastify.log.error(aiError);
    }

    const amountCents = Math.round(tipAmount * 100);
    
    // ID DE GRUPO PARA RASTREAR EL DINERO
    const transferGroup = `chat_${crypto.randomUUID()}`;

    const sessionConfig = {
        payment_method_types: ['card'],
        line_items: [{
            price_data: {
              currency: 'mxn',
              product_data: {
                name: `Mensaje para ${creator.name}`,
                description: 'Los fondos se liberan al recibir respuesta.',
              },
              unit_amount: amountCents,
            },
            quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.FRONTEND_URL}/r/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/u/${publicId}`,
        
        // El dinero se queda en TU plataforma temporalmente
        payment_intent_data: {
            transfer_group: transferGroup, 
        },

        metadata: {
          creatorId: creator.id,
          publicId: creator.publicId,
          content: cleanContent.substring(0, 500),
          anonAlias: alias || "Anónimo",
          fanEmail: fanEmail || "",
          
          tipAmount: String(tipAmount), 
          
          priorityScoreBase: String(tipAmount),
          topicPreference: creator.topicPreference,
          transferGroup: transferGroup 
        },
    };

    try {
      const session = await stripe.checkout.sessions.create(sessionConfig);
      reply.send({ url: session.url });
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: "Error conectando con Stripe" });
    }
  });

  // 3. RECUPERAR CHAT (POLLING)
  fastify.get("/public/chat-from-session", async (req, reply) => {
    const { session_id } = req.query;
    if (!session_id) return reply.code(400).send({ error: "Falta session_id" });

    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if(!session || session.payment_status !== 'paid') {
          return reply.code(404).send({ error: "Pago no completado" });
      }

      const paymentIntentId = session.payment_intent; 

      let message = null;
      for (let i = 0; i < 10; i++) { 
          message = await prisma.chatMessage.findUnique({
              where: { tipPaymentIntentId: paymentIntentId }, 
              include: { chat: { include: { creator: true } } }
          });
          if (message) break; 
          await new Promise(resolve => setTimeout(resolve, 1000)); 
      }

      if (!message) {
           return reply.code(202).send({ 
               status: 'processing', 
               info: "Pago recibido. Procesando mensaje..." 
           });
      }

      reply.send({
        chatId: message.chat.id,
        anonToken: message.chat.anonToken,
        creatorName: message.chat.creator.name,
        preview: message.content,
        ts: message.createdAt
      });

    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: err.message });
    }
  });
}

module.exports = publicRoutes;