// routes/stripeWebhook.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// --- 👇 1. IMPORTAR HELPERS NECESARIOS ---
const { analyzeMessage } = require('../utils/aiAnalyzer');
const { checkAndResetLimit } = require('../utils/paymentHelpers');
// Importamos el helper de email para la Estrategia 2
const { sendAccessLinkEmail } = require('../utils/mailer'); 

module.exports = async function stripeWebhook(fastify, opts) {
  
  // Esta ruta debe estar "raw" para que Stripe pueda verificar la firma
  fastify.post("/webhooks/stripe", {
    config: {
      // Deshabilitar el parser de body de Fastify
      // para obtener el payload "raw" que Stripe necesita
      rawBody: true 
    }
  }, async (req, reply) => {
    
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event;

    // --- 1. VERIFICAR FIRMA (EL "POLICÍA REAL") ---
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
      fastify.log.warn(`⚠️ Fallo en verificación de firma de Webhook Stripe: ${err.message}`);
      return reply.code(400).send(`Webhook Error: ${err.message}`);
    }

    // --- 2. MANEJAR EL EVENTO DE PAGO EXITOSO ---
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // 3. Evitar duplicados (si el webhook se reenvía)
      const existingMessage = await prisma.chatMessage.findUnique({
        where: { tipPaymentIntentId: session.id }
      });
      if (existingMessage) {
        fastify.log.warn(`Webhook duplicado para sesión ${session.id}. Ignorando.`);
        return reply.code(200).send({ ok: true, status: "Duplicado" });
      }

      // 4. Extraer datos del metadata
      fastify.log.info(`Pago de Mensaje Aprobado: ${session.id}`);
      const { 
        publicId, content, alias, tipAmount, 
        priorityScoreBase, topicPreference, fanEmail 
      } = session.metadata;

      // 5. Encontrar al Creador
      let creator = await prisma.creator.findUnique({
        where: { publicId },
      });
      if (!creator) {
        fastify.log.error(`Webhook no puede encontrar creator: ${publicId}`);
        return reply.code(404).send({ error: "Creador no encontrado" });
      }
      
      // 6. Moderación Final de Contenido (E1 + E4)
      let relevanceScore = 5; // Default
      let finalPriorityScore = parseFloat(priorityScoreBase) || 0;
      
      try {
        const analysis = await analyzeMessage(content, topicPreference, false); // false = Usar IA de pago
        
        if (!analysis.isSafe) {
          fastify.log.warn(`Mensaje ${session.id} bloqueado por seguridad POST-pago.`);
          // (Aquí se triggerearía un reembolso automático)
          return reply.code(200).send({ ok: true, status: "Rechazado por moderación" });
        }
        
        relevanceScore = analysis.relevance;
        const relevanceFactor = 1 + (relevanceScore - 5) / 10;
        finalPriorityScore = Math.round(finalPriorityScore * relevanceFactor * 100) / 100;
        
      } catch (aiError) {
        fastify.log.error(aiError, "AI check (webhook) falló, usando score base.");
      }

      // 7. CREAR EL CHAT Y EL MENSAJE (El "Policía" da el OK)
      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken: crypto.randomUUID(),
          anonAlias: alias,
          isOpened: false,
          anonReplied: true, 
        },
      });

      const message = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          alias: alias,
          content: content,
          tipAmount: parseFloat(tipAmount),
          tipStatus: 'PENDING', // (P3) Escrow Blando
          tipPaymentIntentId: session.payment_intent, // ID real del pago para recibo vivo
          priorityScore: finalPriorityScore, // (S6)
          relevanceScore: relevanceScore // (E4)
        },
      });

      // 8. Incrementar Límite (S1)
      creator = await checkAndResetLimit(creator, fastify);
      await prisma.creator.update({
        where: { id: creator.id },
        data: { 
          msgCountToday: { increment: 1 }
        }
      });

      // 9. Notificar al Dashboard (WebSocket)
      fastify.broadcastToDashboard(creator.id, {
        type: 'new_message', 
        chatId: chat.id,
      });

      // 10. Enviar Email de Respaldo (Estrategia 2 - Definitiva)
      if (fanEmail) {
        const chatUrl = `${process.env.FRONTEND_URL}/chats/${chat.anonToken}/${chat.id}`;
        
        // Llamada al helper de mailer
        try {
            await sendAccessLinkEmail(
                fanEmail, 
                chatUrl, 
                creator.name || "el Creador",
                content.substring(0, 50) // Preview para el asunto/cuerpo
            );
            fastify.log.info(`✅ (Email Enviado) Link de acceso enviado a ${fanEmail}`);
        } catch (emailErr) {
            fastify.log.error(`❌ Error enviando email a ${fanEmail}:`, emailErr);
            // No detenemos el webhook si falla el email, ya se cobró
        }
      }

    } else if (event.type === 'pre_approval') {
      // Lógica de suscripción de Mercado Pago (si la tenías) iría aquí
      // O si usas Stripe Subscriptions, sería 'invoice.payment_succeeded'
      fastify.log.info(`Evento de suscripción recibido (si aplica): ${event.type}`);
    }

    // 11. Responder a Stripe que todo está OK
    reply.code(200).send({ received: true });
  });
};