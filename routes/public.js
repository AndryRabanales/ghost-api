// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sanitize } = require("../utils/sanitize");
const { analyzeMessage } = require("../utils/aiAnalyzer");

async function publicRoutes(fastify, opts) {

  // 1. OBTENER PERFIL PÚBLICO
  fastify.get("/public/creator/:publicId", async (req, reply) => {
    const { publicId } = req.params;
    const creator = await prisma.creator.findUnique({ where: { publicId } });
    if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });

    // Calcular escasez
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgCountToday = await prisma.chatMessage.count({
      where: {
        chat: { creatorId: creator.id },
        createdAt: { gte: startOfDay },
        from: 'anon' 
      }
    });

    const DAILY_LIMIT = creator.dailyMsgLimit || 30; 
    const isFull = msgCountToday >= DAILY_LIMIT;

    reply.send({
      creatorName: creator.name,
      baseTipAmountCents: creator.baseTipAmountCents,
      topicPreference: creator.topicPreference,
      premiumContract: creator.premiumContract,
      escasezData: { msgCountToday, dailyMsgLimit: DAILY_LIMIT },
      isFull
    });
  });

  // 2. CREAR SESIÓN DE PAGO (Checkout)
  fastify.post("/public/:publicId/create-checkout-session", async (req, reply) => {
    const { publicId } = req.params;
    const { content, alias, fanEmail, tipAmount } = req.body; 

    const creator = await prisma.creator.findUnique({ where: { publicId } });
    if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });

    if (!tipAmount || tipAmount < 10) {
        return reply.code(400).send({ error: "El monto mínimo es $10 MXN" });
    }

    const cleanContent = sanitize(content);
    
    // Validación IA
    try {
        const safetyCheck = await analyzeMessage(cleanContent, creator.topicPreference);
        if (!safetyCheck.isSafe) {
            return reply.code(400).send({ 
                error: safetyCheck.reason || "Mensaje bloqueado por moderación." 
            });
        }
    } catch (aiError) {
        fastify.log.error(aiError); // Fallo silencioso en producción para no perder venta
    }

    const amountCents = Math.round(tipAmount * 100);
    
    const sessionConfig = {
        payment_method_types: ['card'],
        line_items: [{
            price_data: {
              currency: 'mxn',
              product_data: {
                name: `Mensaje para ${creator.name}`,
                description: 'Prioridad Alta',
              },
              unit_amount: amountCents,
            },
            quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.FRONTEND_URL}/r/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/u/${publicId}`,
        metadata: {
          creatorId: creator.id,
          publicId: creator.publicId,
          content: cleanContent.substring(0, 500),
          anonAlias: alias || "Anónimo",
          fanEmail: fanEmail || "",
          // Pasamos datos extra para el webhook
          priorityScoreBase: String(tipAmount), // Usamos el monto como base de prioridad
          topicPreference: creator.topicPreference
        },
    };

    // Stripe Connect (Split de pagos)
    if (creator.stripeAccountId && creator.stripeAccountOnboarded) {
        const platformFeePercent = 0.20; 
        const applicationFee = Math.round(amountCents * platformFeePercent);
        sessionConfig.payment_intent_data = {
            application_fee_amount: applicationFee,
            transfer_data: { destination: creator.stripeAccountId },
        };
    }

    try {
      const session = await stripe.checkout.sessions.create(sessionConfig);
      reply.send({ url: session.url });
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: "Error conectando con Stripe" });
    }
  });

  // 3. RECUPERAR CHAT TRAS PAGO (CON POLLING FIX) ✅✅✅
  fastify.get("/public/chat-from-session", async (req, reply) => {
    const { session_id } = req.query;
    if (!session_id) return reply.code(400).send({ error: "Falta session_id" });

    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if(!session || session.payment_status !== 'paid') {
          return reply.code(404).send({ error: "Pago no completado" });
      }

      const paymentIntentId = session.payment_intent; 

      // --- BUCLE DE ESPERA (POLLING) ---
      let message = null;
      for (let i = 0; i < 5; i++) { // 5 intentos
          message = await prisma.chatMessage.findUnique({
              where: { tipPaymentIntentId: paymentIntentId }, 
              include: { chat: { include: { creator: true } } }
          });
          if (message) break; // ¡Encontrado!
          await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2s
      }
      // ----------------------------------

      if (!message) {
           return reply.code(202).send({ 
               status: 'processing', 
               info: "Procesando mensaje. Recarga en unos segundos." 
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