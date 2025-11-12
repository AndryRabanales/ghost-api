// andryrabanales/ghost-api/ghost-api-abfc35e2f3750c5ab2764fb71701208dc948b301/routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const livesUtils = require('../utils/lives'); 
const { sanitize } = require("../utils/sanitize");

async function creatorsRoutes(fastify, opts) {
  
  // ... (ruta POST /creators - sin cambios) ...
  fastify.post("/creators", async (req, reply) => {
    try {
      const { name } = req.body;
      if (!name) {
        return reply.code(400).send({ error: "El nombre es obligatorio" });
      }
      const dashboardId = crypto.randomUUID();
      const publicId = crypto.randomUUID();
      const creator = await prisma.creator.create({
        data: {
          id: dashboardId,
          publicId,
          name,
          lives: 6,
          maxLives: 6,
          lastUpdated: new Date(),
          // baseTipAmountCents se establece por defecto gracias al schema
        },
      });
      const token = fastify.generateToken(creator);
      const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const dashboardUrl = `${baseUrl}/dashboard/${dashboardId}`;
      const publicUrl = `${baseUrl}/u/${publicId}`;
      reply.code(201).send({
        dashboardUrl,
        publicUrl,
        dashboardId,
        publicId,
        token,
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error creando creator" });
    }
  });

  // --- RUTA (GET /creators/me) ---
  // --- CAMBIO: Ahora devuelve 'baseTipAmountCents' ---
  fastify.get("/creators/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      let creator = null;
      if (req.user.id && req.user.id !== "null") {
        creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
      } else if (req.user.publicId && req.user.publicId !== "null") {
        creator = await prisma.creator.findUnique({ where: { publicId: req.user.publicId } });
      }
      if (!creator) {
        return reply.code(404).send({ error: "Creator no encontrado" });
      }

      // --- LÓGICA DE EXPIRACIÓN DE PREMIUM (sin cambios) ---
      if (creator.isPremium && creator.premiumExpiresAt && new Date() > new Date(creator.premiumExpiresAt)) {
        creator = await prisma.creator.update({
          where: { id: creator.id },
          data: { isPremium: false, subscriptionStatus: 'expired' }
        });
        fastify.log.info(`La suscripción Premium para ${creator.id} ha expirado.`);
      }
 
      // --- LÓGICA DE VIDAS (sin cambios) ---
      const updated = await livesUtils.refillLivesIfNeeded(creator);

      // --- CÁLCULO DE BALANCE (sin cambios) ---
      const availableBalanceResult = await prisma.chatMessage.aggregate({
        _sum: { tipAmount: true },
        where: {
          chat: { creatorId: creator.id },
          tipStatus: 'FULFILLED',
          from: 'anon'
        },
      });
      const pendingBalanceResult = await prisma.chatMessage.aggregate({
        _sum: { tipAmount: true },
        where: {
          chat: { creatorId: creator.id },
          tipStatus: 'PENDING',
          from: 'anon'
        },
      });
      const availableBalance = availableBalanceResult._sum.tipAmount || 0;
      const pendingBalance = pendingBalanceResult._sum.tipAmount || 0;

      reply.send({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        publicId: updated.publicId,
        lives: updated.lives, 
        maxLives: updated.maxLives,
        minutesToNextLife: livesUtils.minutesToNextLife(updated), 
        isPremium: updated.isPremium,
        stripeAccountId: updated.stripeAccountId, 
        stripeAccountOnboarded: updated.stripeAccountOnboarded,
        availableBalance: availableBalance,
        pendingBalance: pendingBalance,
        premiumContract: updated.premiumContract || "Respuesta de alta calidad.",
        // --- CAMBIO: Devolver el precio base ---
        baseTipAmountCents: updated.baseTipAmountCents
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });
  
  // --- RUTA (P5): SIMULACIÓN DE STRIPE ONBOARDING (sin cambios) ---
  fastify.post(
    "/creators/stripe-onboarding",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        if (!creator) {
          return reply.code(404).send({ error: "Creador no encontrado" });
        }

        fastify.log.info(`✅ (SIMULADO) Link de Onboarding generado para ${creator.id}`);
        const simulatedStripeUrl = "https://connect.stripe.com/setup/s/simulated-onboarding-link";
        
        await prisma.creator.update({
          where: { id: creator.id },
          data: { 
            stripeAccountOnboarded: true, 
            stripeAccountId: "sim_acct_12345"
          },
        });

        reply.send({ onboarding_url: simulatedStripeUrl });

      } catch (err) {
        fastify.log.error("❌ Error en /creators/stripe-onboarding (Simulado):", err);
        reply.code(500).send({ error: "Error al simular el link de Stripe Connect" });
      }
    }
  );

  // --- RUTA (S3): Actualizar el contrato Premium. ---
  // --- CAMBIO: Se usa 'premiumContract' del body, no el body entero ---
// andryrabanales/ghost-api/ghost-api-e73e7b65792caea8c21e450c185fc2ac0dc20397/routes/creators.js

fastify.post(
  "/creators/:creatorId/update-contract",
  { preHandler: [fastify.authenticate] },
  async (req, reply) => {
    const { creatorId } = req.params;
    const { premiumContract } = req.body; 

    if (req.user.id !== creatorId) {
      return reply.code(403).send({ error: "No autorizado" });
    }

    const MAX_LENGTH = 120; // Límite que ya tenías en el frontend
    if (typeof premiumContract !== 'string' || premiumContract.length > MAX_LENGTH) {
      return reply.code(400).send({ error: "Datos de contrato inválidos o exceden el límite de caracteres." });
    }
    
    const cleanContract = sanitize(premiumContract);

    try {
      const updatedCreator = await prisma.creator.update({
        where: { id: creatorId },
        data: { premiumContract: cleanContract },
        select: { premiumContract: true, publicId: true } 
      });

      fastify.broadcastToPublic(updatedCreator.publicId, {
          type: 'CREATOR_INFO_UPDATE',
          premiumContract: updatedCreator.premiumContract,
      });

      reply.send({ premiumContract: updatedCreator.premiumContract });
    } catch (err) {
      fastify.log.error("❌ Error al actualizar contrato:", err);
      reply.code(500).send({ error: "Error interno al guardar el contrato." });
    }
  }
);



// ... (código existente) ...


// routes/public.js

// Asegúrate de que analyzeMessage esté importado:
// const { analyzeMessage } = require('../utils/aiAnalyzer'); 
// const { sanitize } = require("../utils/sanitize"); 
// const { calculatePriorityScore, checkAndResetLimit } = (tus helpers)

fastify.post("/public/:publicId/messages", async (req, reply) => {
  try {
    const { publicId } = req.params;
    const originalContent = req.body.content;
    const originalAlias = req.body.alias || "Anónimo";
    
    const tipAmount = req.body.tipAmount || 0; 
    
    if (!originalContent || originalContent.trim().length < 3) {
      return reply.code(400).send({ error: "El mensaje es muy corto." });
    }
    
    const cleanContent = sanitize(originalContent);
    const cleanAlias = sanitize(originalAlias);

    // --- 1. Fetch Creator Data (Incluyendo topicPreference) ---
    let creator = await prisma.creator.findUnique({
      where: { publicId },
      select: { 
          id: true, 
          name: true,
          baseTipAmountCents: true, 
          dailyMsgLimit: true, 
          msgCountToday: true, 
          msgCountLastReset: true, 
          premiumContract: true,
          topicPreference: true // <-- CLAVE: Obtener preferencia para la IA
      } 
    });

    if (!creator) {
      return reply.code(404).send({ error: "Creador no encontrado" });
    }
    
    // --- 2. Lógica de Límite Diario (S1) ---
    if (creator.dailyMsgLimit > 0) {
        creator = await checkAndResetLimit(creator); 
        if (tipAmount > 0 && creator.msgCountToday >= creator.dailyMsgLimit) {
            return reply.code(429).send({ 
                error: "Este creador ha alcanzado su límite diario de mensajes premium. Intenta de nuevo mañana.",
                code: "DAILY_LIMIT_REACHED"
            });
        }
    }

    // --- 3. VALIDACIÓN DE PAGO MÍNIMO OBLIGATORIO (P2) ---
    const baseTipAmountPesos = (creator.baseTipAmountCents || 10000) / 100;

    if (tipAmount < baseTipAmountPesos) {
        return reply.code(400).send({ 
          error: `El pago mínimo para este creador es $${baseTipAmountPesos} MXN.`,
          code: "MINIMUM_PAYMENT_REQUIRED"
        });
    }
    // --- FIN: VALIDACIÓN DE PAGO MÍNIMO ---


    // --- 4. INICIO: DOBLE MODERACIÓN Y CALCULO DE PRIORIDAD (E1, E4) ---
    let priorityScoreBase = calculatePriorityScore(tipAmount);
    let finalPriorityScore = priorityScoreBase;
    let relevanceScore = 5; 

    try {
        // LLAMADA CLAVE: Doble verificación de Seguridad (E1) y Relevancia (E4)
        const analysis = await analyzeMessage(cleanContent, creator.topicPreference);
        
        // E1: Bloqueo de Seguridad (Rechazo automático)
        if (!analysis.isSafe) {
            // Si la SEGURIDAD falla, se rechaza inmediatamente (E1)
            return reply.code(400).send({ error: analysis.reason || 'Mensaje bloqueado por moderación.' });
        }
        
        // E4: Aplicar Bonus/Penalización por Relevancia
        relevanceScore = analysis.relevance;
        const relevanceFactor = 1 + (relevanceScore - 5) / 10; // Factor de -0.4x a +0.5x
        finalPriorityScore = Math.round(priorityScoreBase * relevanceFactor * 100) / 100;

    } catch (aiError) {
        fastify.log.error("❌ Error grave en AI Analyzer:", aiError);
        // Si la IA falla, usamos el score base sin penalización para no detener el servicio.
        relevanceScore = 5; 
        finalPriorityScore = priorityScoreBase;
    }
    // --- FIN: DOBLE MODERACIÓN Y CALCULO DE PRIORIDAD ---

    
    const anonToken = crypto.randomUUID();

    const chat = await prisma.chat.create({
      data: {
        creatorId: creator.id,
        anonToken,
        anonAlias: cleanAlias,
      },
    });

    // --- 5. CREACIÓN DEL MENSAJE FINAL (Escrow Blando y Scoring) ---
    const message = await prisma.chatMessage.create({
      data: {
        chatId: chat.id,
        from: "anon",
        alias: cleanAlias,
        content: cleanContent,
        tipAmount: tipAmount,
        tipStatus: 'PENDING', // <--- ESCROW BLANDO: Dinero retenido
        tipPaymentIntentId: crypto.randomUUID(),
        priorityScore: finalPriorityScore, // <--- GUARDAMOS EL SCORE FINAL (S6)
        relevanceScore: relevanceScore // <--- GUARDAMOS LA RELEVANCIA (E4)
      },
    });
    
    // (S1): Incrementar el contador
    if (creator.dailyMsgLimit > 0) {
        await prisma.creator.update({
            where: { id: creator.id },
            data: { msgCountToday: { increment: 1 } }
        });
    }

    fastify.broadcastToDashboard(creator.id, {
      type: 'message',
      ...message,
    });

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const chatUrl = `${baseUrl}/chats/${anonToken}/${chat.id}`;

    // --- 6. REDIRECCIÓN EXITOSA ---
    return reply.code(201).send({
      success: true,
      chatId: chat.id,
      anonToken,
      chatUrl,
      creatorName: creator.name,
      creatorPremiumContract: creator.premiumContract,
      message: {
        id: message.id,
        content: message.content,
        alias: message.alias,
        createdAt: message.createdAt,
      },
    });
  } catch (err) {
    fastify.log.error("❌ Error en /public/:publicId/messages:", err);
    // Nota: Si el error viene de Stripe (pago), debe manejar el reembolso. 
    // Asumimos que el front-end maneja los errores 400 (AI/Mínimo) adecuadamente.
    return reply.code(500).send({ error: "Error enviando mensaje" });
  }
});




  // --- RUTA NUEVA: Para guardar la preferencia temática del creador (E4) ---
  fastify.post(
    "/creators/:creatorId/update-topic",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { creatorId } = req.params;
      const { topicPreference } = req.body; // El tema que el creador quiere

      if (req.user.id !== creatorId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      const MAX_LENGTH = 100; // Suficiente para describir el nicho

      if (typeof topicPreference !== 'string' || topicPreference.length > MAX_LENGTH) {
        return reply.code(400).send({ error: `La preferencia de tema es inválida o excede los ${MAX_LENGTH} caracteres.` });
      }

      const cleanTopic = sanitize(topicPreference);

      try {
        const updatedCreator = await prisma.creator.update({
          where: { id: creatorId },
          data: { topicPreference: cleanTopic },
          select: { topicPreference: true, publicId: true }
        });

        // Notificar a la página pública que el precio cambió
        fastify.broadcastToPublic(updatedCreator.publicId, {
            type: 'CREATOR_INFO_UPDATE',
            topicPreference: updatedCreator.topicPreference,
        });

        reply.send({ success: true, topicPreference: updatedCreator.topicPreference });
      } catch (err) {
        fastify.log.error("❌ Error al actualizar preferencia de tema:", err);
        reply.code(500).send({ error: "Error interno al guardar el tema." });
      }
    }
  );
  // --- FIN RUTA NUEVA ---
  
// ... (resto del código del archivo creators.js)

  // --- RUTA NUEVA: Para guardar la configuración de precio ---
  fastify.post(
    "/creators/:creatorId/settings",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { creatorId } = req.params;
      const { baseTipAmountCents } = req.body;

      if (req.user.id !== creatorId) {
        return reply.code(403).send({ error: "No autorizado" });
      }
      
      const MIN_PRICE_CENTS = 10000; // $100.00 MXN

      if (typeof baseTipAmountCents !== 'number' || baseTipAmountCents < MIN_PRICE_CENTS) {
        return reply.code(400).send({ error: `El precio mínimo debe ser de $${MIN_PRICE_CENTS / 100} MXN.` });
      }

      try {
        const updatedCreator = await prisma.creator.update({
          where: { id: creatorId },
          data: { baseTipAmountCents: baseTipAmountCents },
          select: { baseTipAmountCents: true, publicId: true }
        });

        // Notificar a la página pública que el precio cambió
        fastify.broadcastToPublic(updatedCreator.publicId, {
            type: 'CREATOR_INFO_UPDATE',
            baseTipAmountCents: updatedCreator.baseTipAmountCents,
        });

        reply.send({ success: true, baseTipAmountCents: updatedCreator.baseTipAmountCents });
      } catch (err) {
        fastify.log.error("❌ Error al actualizar precio base:", err);
        reply.code(500).send({ error: "Error interno al guardar el precio." });
      }
    }
  );
  // --- FIN RUTA NUEVA ---


  // --- RUTA (GET /dashboard/:dashboardId/chats) ---
  // --- CAMBIO: Ordenar por 'priorityScore' ---
  fastify.get(
    "/dashboard/:dashboardId/chats",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const { dashboardId } = req.params;
        if (req.user.id !== dashboardId) {
          return reply.code(403).send({ error: "No autorizado" });
        }
  
        const chats = await prisma.chat.findMany({
          where: { creatorId: dashboardId },
          include: {
            messages: {
              orderBy: { createdAt: "desc" }, 
              take: 1, // Tomamos el último mensaje (que tiene el score)
            },
          },
        });
  
        const formatted = chats.map(chat => ({
          id: chat.id,
          anonAlias: chat.anonAlias || "Anónimo",
          isOpened: chat.isOpened,
          anonReplied: chat.anonReplied, 
          createdAt: chat.createdAt,
          previewMessage: chat.messages[0] || null
        }));
        
        // --- CAMBIO: Ordenar por 'priorityScore' usando tu fórmula ---
        formatted.sort((a, b) => {
            // 1. Obtener el puntaje de prioridad (usamos 0 si no hay)
            const scoreA = a.previewMessage?.priorityScore || 0;
            const scoreB = b.previewMessage?.priorityScore || 0;
            
            // Prioridad principal: Puntaje (mayor a menor)
            if (scoreA !== scoreB) {
                return scoreB - scoreA; // Mayor puntaje primero
            }
            
            // Prioridad secundaria: Fecha (más reciente primero)
            const dateA = new Date(a.previewMessage?.createdAt || a.createdAt).getTime();
            const dateB = new Date(b.previewMessage?.createdAt || b.createdAt).getTime();
            return dateB - dateA;
        });
        // --- FIN CAMBIO ---
        
        reply.send(formatted); 
      
      } catch (err) {
        fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats:", err);
        reply.code(500).send({ error: "Error obteniendo chats" });
      }
    }
  );
}

module.exports = creatorsRoutes;