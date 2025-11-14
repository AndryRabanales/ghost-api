// Contenido para: andryrabanales/ghost-api/ghost-api-e1322b6d8cb4a19aa105871a038f33f8393d703e/routes/premiumWebhook.js
const { MercadoPagoConfig, Payment, PreApproval } = require("mercadopago");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const prisma = new PrismaClient();

// --- 👇 1. IMPORTAR HELPERS NECESARIOS ---
const { analyzeMessage } = require('../utils/aiAnalyzer');
const { sanitize } = require("../utils/sanitize");
// (No necesitamos calculatePriorityScore aquí, ya viene en el metadata)

// (La función validateSignature se queda igual, aunque no la estés usando)
function validateSignature(req, secret) {
    // ... (código existente)
}

module.exports = async function premiumWebhook(fastify, opts) {
  fastify.post("/webhooks/mercadopago", async (req, reply) => {
    const notification = req.body;
    fastify.log.info({ notification }, "🔔 Notificación de Webhook recibida");

    try {
      // (Validación de firma omitida, como en tu original)
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      const client = new MercadoPagoConfig({ accessToken });

      // --- LÓGICA DE SUSCRIPCIÓN (Sin cambios) ---
      if (notification.type === 'subscription_preapproval') {
        fastify.log.info("Procesando webhook de Suscripción...");
        const preapproval = new PreApproval(client);
        const subscriptionInfo = await preapproval.get({ id: notification.data.id });
        // ... (resto de tu lógica de suscripción)
      }

      // --- 👇 2. LÓGICA AMPLIADA PARA PAGOS (TAREA 1D) ---
      if (notification.type === 'payment') {
        fastify.log.info("Procesando webhook de Pago...");
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: notification.data.id });
        
        if (paymentInfo.status === 'approved') {
          const metadata = paymentInfo.metadata;
          const externalReference = paymentInfo.external_reference; // Para Tarea 4

          // --- CASO A: Es un pago por mensaje (Flujo Tarea 1) ---
          if (metadata && metadata.type === "per_message_payment") {
            fastify.log.info(`Pago de Mensaje Aprobado: ${paymentInfo.id} (TX: ${externalReference})`);
            
            // 1. Extraer datos del metadata
            const { 
              publicId, content, alias, tipAmount, 
              priorityScoreBase, topicPreference, fanEmail 
            } = metadata;

            // 2. Encontrar al Creador
            const creator = await prisma.creator.findUnique({
              where: { publicId },
            });
            if (!creator) {
              fastify.log.error(`Webhook no puede encontrar creator: ${publicId}`);
              return reply.code(404).send({ error: "Creador no encontrado" });
            }
            
            // 3. Moderación Final de Contenido (E1 + E4)
            let relevanceScore = 5; // Default
            let finalPriorityScore = parseFloat(priorityScoreBase) || 0;
            
            try {
              const analysis = await analyzeMessage(content, topicPreference);
              if (!analysis.isSafe) {
                fastify.log.warn(`Mensaje ${paymentInfo.id} bloqueado por seguridad POST-pago.`);
                // (En un futuro, esto debería triggerear un reembolso automático)
                return reply.code(200).send({ ok: true, status: "Rechazado por moderación" });
              }
              
              relevanceScore = analysis.relevance;
              // Recalcular score final con la relevancia (S6)
              const relevanceFactor = 1 + (relevanceScore - 5) / 10;
              finalPriorityScore = Math.round(finalPriorityScore * relevanceFactor * 100) / 100;
              
            } catch (aiError) {
              fastify.log.error(aiError, "AI check (webhook) falló, usando score base.");
            }

            // 4. CREAR EL CHAT Y EL MENSAJE (El "Policía" da el OK)
            const chat = await prisma.chat.create({
              data: {
                creatorId: creator.id,
                anonToken: crypto.randomUUID(), // El fan no lo sabe aún (Tarea 4)
                anonAlias: alias,
                isOpened: false, // Inicia cerrado
                anonReplied: true, // Inicia como "nuevo" para el creador
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
                tipPaymentIntentId: paymentInfo.id.toString(), // (Para Tarea 4b)
                externalReference: externalReference, // (Para Tarea 4b)
                priorityScore: finalPriorityScore, // (S6)
                relevanceScore: relevanceScore // (E4)
              },
            });

            // 5. Incrementar Límite (S1) - Lógica manual
            const now = new Date();
            const lastReset = new Date(creator.msgCountLastReset);
            const RESET_HOURS = 12 * 60 * 60 * 1000;
            let newCount = creator.msgCountToday + 1;
            let newResetTime = creator.msgCountLastReset;
            
            if (now.getTime() - lastReset.getTime() >= RESET_HOURS) {
              newCount = 1; // Es el primero del nuevo ciclo
              newResetTime = now;
            }
            await prisma.creator.update({
              where: { id: creator.id },
              data: { 
                msgCountToday: newCount,
                msgCountLastReset: newResetTime
              }
            });

            // 6. Notificar al Dashboard
            fastify.broadcastToDashboard(creator.id, {
              type: 'new_message', // El dashboard debe escuchar esto
              chatId: chat.id,
              // (envía los datos del chat/mensaje que necesite MessageList.jsx para refrescar)
            });

            // 7. Enviar Email de Respaldo (E2 / Tarea 4)
            if (fanEmail) {
              const chatUrl = `${process.env.FRONTEND_URL}/chats/${chat.anonToken}/${chat.id}`;
              // (Aquí iría tu lógica real de envío de email)
              fastify.log.info(`(Simulación Email E2) Enviando a ${fanEmail} el link: ${chatUrl}`);
            }

          // --- CASO B: Es un pago de Suscripción Premium (Flujo antiguo) ---
          } else if (paymentInfo.metadata?.creator_id) {
            const creatorId = paymentInfo.metadata.creator_id;
            const expiresDate = new Date();
            expiresDate.setFullYear(expiresDate.getFullYear() + 100); // 100 años (pago único)

            await prisma.creator.update({
              where: { id: creatorId },
              data: { 
                isPremium: true,
                premiumExpiresAt: expiresDate, // Marcar la expiración
                subscriptionStatus: 'approved'
              },
            });
            fastify.log.info(`✅ PREMIUM (pago único) activado para creator ${creatorId}.`);
          }
        }
      }

      reply.code(200).send({ ok: true });
    } catch (err) {
      fastify.log.error("❌ Error en webhook:", err);
      reply.code(500).send({ error: "Error procesando el webhook" });
    }
  });
};