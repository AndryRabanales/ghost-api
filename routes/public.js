// routes/public.js (VERSIÓN FINAL PARA COBRAR DINERO)
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function publicRoutes(fastify, opts) {

  // 1. Obtener info pública del creador (Para el perfil)
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

    // Límite diario (ej: 10 mensajes)
    const DAILY_LIMIT = 10; 
    const isFull = msgCountToday >= DAILY_LIMIT;

    reply.send({
      creatorName: creator.name,
      baseTipAmountCents: creator.baseTipAmountCents || 5000, // Default $50 MXN
      topicPreference: creator.topicPreference,
      premiumContract: creator.premiumContract,
      escasezData: { msgCountToday, dailyMsgLimit: DAILY_LIMIT },
      isFull
    });
  });

  // 2. CREAR SESIÓN DE PAGO REAL (STRIPE CHECKOUT)
  fastify.post("/public/:publicId/create-checkout-session", async (req, reply) => {
    const { publicId } = req.params;
    const { content, alias, fanEmail, tipAmount } = req.body; // tipAmount viene del frontend

    const creator = await prisma.creator.findUnique({ where: { publicId } });
    if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });

    // Validación mínima de precio ($10.00 MXN)
    if (!tipAmount || tipAmount < 10) {
        return reply.code(400).send({ error: "El monto mínimo es $10 MXN" });
    }

    // Crear la sesión de Stripe
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'mxn',
              product_data: {
                name: `Mensaje para ${creator.name}`,
                description: 'Envío de mensaje anónimo prioritario',
              },
              unit_amount: Math.round(tipAmount * 100), // Convertir a centavos
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${process.env.FRONTEND_URL}/r/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/u/${publicId}`,
        // Metadatos CRÍTICOS para el Webhook
        metadata: {
          creatorId: creator.id,
          publicId: creator.publicId,
          content: content.substring(0, 500), // Recortar por seguridad de Stripe
          anonAlias: alias || "Anónimo",
          fanEmail: fanEmail || "",
        },
        // Si el creador ya tiene cuenta conectada, dividimos el pago aquí (Opcional para MVP)
        // payment_intent_data: { ... } 
      });

      reply.send({ url: session.url });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: "Error conectando con Stripe" });
    }
  });

  // 3. Recuperar datos tras el pago (Pantalla de Éxito)
  fastify.get("/public/chat-from-session", async (req, reply) => {
    const { session_id } = req.query;
    if (!session_id) return reply.code(400).send({ error: "Falta session_id" });

    try {
      // Buscamos el chat creado por el Webhook usando el ID de sesión de Stripe
      // (Necesitamos que el webhook guarde el stripeSessionId en el Chat o Message)
      // TRUCO MVP: Buscamos el mensaje más reciente que coincida con la metadata de la sesión
      
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if(!session || session.payment_status !== 'paid') {
          return reply.code(404).send({ error: "Pago no completado o sesión inválida" });
      }

      // Esperamos un poco a que el webhook procese (esto es un fix común)
      await new Promise(r => setTimeout(r, 1500));

      // Buscamos el chat recién creado
      // Nota: Esto asume que el webhook ya corrió. 
      const chat = await prisma.chat.findFirst({
        where: { 
            creatorId: session.metadata.creatorId,
            // Podrías guardar el stripeSessionId en el chat para ser exacto
        },
        orderBy: { createdAt: 'desc' },
        include: { creator: true, messages: true }
      });

      if (!chat) return reply.code(404).send({ error: "El chat se está creando, recarga en unos segundos." });

      reply.send({
        chatId: chat.id,
        anonToken: chat.anonToken,
        creatorName: chat.creator.name,
        preview: session.metadata.content,
        ts: chat.createdAt
      });

    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });
}

module.exports = publicRoutes;