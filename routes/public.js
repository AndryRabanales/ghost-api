// Contenido para: andryrabanales/ghost-api/ghost-api-e1322b6d8cb4a19aa105871a038f33f8393d703e/routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const { analyzeMessage } = require('../utils/aiAnalyzer');
const { calculatePriorityScore, checkAndResetLimit } = require('../utils/paymentHelpers');

// --- 👇 1. IMPORTAR STRIPE ---
// (Asegúrate de haber corrido: npm install stripe)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function publicRoutes(fastify, opts) {
  
  // --- 👇 2. RUTA DE MENSAJES INSEGURA (DESHABILITADA) ---
  // (Requisito: "Borrar Lógica Insegura")
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    fastify.log.warn(`Intento de uso de ruta insegura deshabilitada: POST /public/${req.params.publicId}/messages`);
    return reply.code(403).send({ 
      error: "Esta ruta ha sido deshabilitada por seguridad. Utilice la nueva ruta de checkout.",
      code: "DEPRECATED_ROUTE"
    });
  });
  // --- FIN DE RUTA DESHABILITADA ---


  // --- 👇 3. NUEVA RUTA DE CHECKOUT (EL "VENDEDOR" - P1 con Stripe) ---
  fastify.post("/public/:publicId/create-checkout-session", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const { content, alias, tipAmount, fanEmail } = req.body;

      // 1. Validar Mensaje
      if (!content || content.trim().length < 3) {
        return reply.code(400).send({ error: "El mensaje es muy corto." });
      }
      
      const cleanContent = sanitize(content);
      const cleanAlias = sanitize(alias) || "Anónimo";
      const cleanEmail = sanitize(fanEmail) || null;

      // 2. Validar Alias (Etapas gratuitas de IA)
      try {
        const aliasAnalysis = await analyzeMessage(cleanAlias, null, true); // true = skipPago
        if (!aliasAnalysis.isSafe) {
          return reply.code(400).send({ error: "Alias bloqueado por moderación." });
        }
      } catch (aiError) {
         fastify.log.warn(aiError, "AI check (alias) falló, permitiendo...");
      }

      // 3. Validar Creador, Límite (S1) y Precio Mínimo (P2)
      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { 
            id: true, name: true, baseTipAmountCents: true, dailyMsgLimit: true, 
            msgCountToday: true, msgCountLastReset: true, topicPreference: true 
        } 
      });
      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      creator = await checkAndResetLimit(creator, fastify); 
      
      if (creator.dailyMsgLimit > 0 && creator.msgCountToday >= creator.dailyMsgLimit) {
          return reply.code(429).send({ 
              error: "Este creador ha alcanzado su límite diario de mensajes premium. Intenta de nuevo mañana.",
              code: "DAILY_LIMIT_REACHED"
          });
      }

      const baseTipAmountPesos = (creator.baseTipAmountCents || 10000) / 100; // Fallback a $100
      const totalAmountNum = parseFloat(tipAmount);

      if (isNaN(totalAmountNum) || totalAmountNum < baseTipAmountPesos) {
          return reply.code(400).send({ 
            error: `El pago mínimo para este creador es $${baseTipAmountPesos.toFixed(2)} MXN.`,
            code: "MINIMUM_PAYMENT_REQUIRED"
          });
      }

      // 4. Calcular Score Base (S6)
      const priorityScoreBase = calculatePriorityScore(totalAmountNum);

      // 5. Crear Sesión de Stripe Checkout
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'mxn', // Usar MXN
              product_data: {
                name: `Mensaje Premium para ${creator.name}`,
                description: cleanContent.slice(0, 100) + "...",
              },
              unit_amount: Math.round(totalAmountNum * 100), // Stripe usa centavos
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        // Pasar el email del fan a Stripe (para recibos y Tarea 4)
        customer_email: cleanEmail,
        // --- METADATA CRÍTICA (Se envía al Webhook) ---
        metadata: {
          publicId: publicId,
          content: cleanContent,
          alias: cleanAlias,
          tipAmount: totalAmountNum,
          priorityScoreBase: priorityScoreBase,
          topicPreference: creator.topicPreference,
          fanEmail: cleanEmail
        },
        // --- CLAVE PARA TAREA 4 (Recibo Vivo) ---
        success_url: `${process.env.FRONTEND_URL}/r/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/u/${publicId}?payment=failed`,
      });

      fastify.log.info(`Sesión de Stripe creada para ${publicId} (ID: ${session.id})`);
      // Devolvemos la URL de pago al frontend
      reply.send({ url: session.url });

    } catch (err) {
      fastify.log.error(err, "Error en /create-checkout-session (Stripe)");
      reply.code(500).send({ error: "Error al crear la sesión de pago." });
    }
  });
  // --- FIN DE NUEVA RUTA ---


  // (Las otras rutas GET .../escasez, .../creator, .../info no cambian)
  
  fastify.get("/public/:publicId/escasez", async (req, reply) => {
    try {
      const { publicId } = req.params;
      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { id: true, dailyMsgLimit: true, msgCountToday: true, msgCountLastReset: true }
      });
      if (!creator) {
        return reply.send({ dailyMsgLimit: 1000, msgCountToday: 0, remainingSlots: 1000, resetTime: new Date(new Date().getTime() + 12 * 60 * 60 * 1000) });
      }
      creator = await checkAndResetLimit(creator, fastify); 
      const remaining = Math.max(0, creator.dailyMsgLimit - creator.msgCountToday);
      const resetTime = new Date(new Date(creator.msgCountLastReset).getTime() + 12 * 60 * 60 * 1000);
      reply.send({ dailyMsgLimit: creator.dailyMsgLimit, msgCountToday: creator.msgCountToday, remainingSlots: remaining, resetTime: resetTime });
    } catch (err) {
      fastify.log.error(err, "❌ Error en /public/:publicId/escasez:");
      return reply.code(500).send({ error: "Error obteniendo datos de escasez" });
    }
  });
  
  fastify.get("/public/creator/:publicId", async (req, reply) => {
    try {
      const { publicId } = req.params;
      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { 
          id: true, name: true, premiumContract: true, dailyMsgLimit: true,
          msgCountToday: true, msgCountLastReset: true, baseTipAmountCents: true,
          topicPreference: true
        }
      });
      if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });
      creator = await checkAndResetLimit(creator, fastify); 
      const isFull = (creator.dailyMsgLimit > 0) && (creator.msgCountToday >= creator.dailyMsgLimit);
      const topic = creator.topicPreference || "Cualquier mensaje respetuoso.";
      reply.send({
        creatorName: creator.name,
        premiumContract: creator.premiumContract,
        topicPreference: topic,
        baseTipAmountCents: creator.baseTipAmountCents,
        escasezData: { dailyMsgLimit: creator.dailyMsgLimit, msgCountToday: creator.msgCountToday, },
        isFull: isFull
      });
    } catch (err) {
      fastify.log.error(err, "❌ Error en GET /public/creator/:publicId:");
      return reply.code(500).send({ error: "Error obteniendo información del creador" });
    }
  });

  fastify.get("/public/:publicId/info", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const creator = await prisma.creator.findUnique({ 
        where: { publicId },
        select: { name: true, lastActive: true } 
      });
      if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });
      reply.send({ name: creator.name, lastActiveAt: creator.lastActive });
    } catch (err) {
      fastify.log.error(err, "❌ Error en /public/:publicId/info:");
      return reply.code(500).send({ error: "Error obteniendo información del creador" });
    }
  });
}

module.exports = publicRoutes;