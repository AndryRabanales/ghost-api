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
        baseTipAmountCents: updated.baseTipAmountCents,
        // --- AÑADIDO: Devolver preferencia de tema ---
        topicPreference: updated.topicPreference || "Cualquier mensaje respetuoso."
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });
  
  // --- RUTA (P5): SIMULACIÓN DE STRIPE ONBOARDING (CORREGIDA) ---
  fastify.post(
    "/creators/stripe-onboarding",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        if (!creator) {
          return reply.code(404).send({ error: "Creador no encontrado" });
        }

        const simulatedStripeUrl = "https://connect.stripe.com/setup/s/simulated-onboarding-link";

        // --- 👇 FIX 1 (Idempotencia) 👇 ---
        // Si el creador YA ESTÁ onboardeado, no intentes actualizar la DB.
        // Solo envíale el link de nuevo.
        if (creator.stripeAccountOnboarded && creator.stripeAccountId) {
          fastify.log.info(`✅ (SIMULADO) Link de Onboarding RE-GENERADO para ${creator.id}`);
          // Simplemente enviamos el link sin tocar la DB
          return reply.send({ onboarding_url: simulatedStripeUrl });
        }
        // --- 👆 FIN DE FIX 1 👆 ---

        // Si es la primera vez, actualiza la DB...
        fastify.log.info(`✅ (SIMULADO) Link de Onboarding INICIAL generado para ${creator.id}`);
        
        // --- 👇 FIX 2 (Unicidad) 👇 ---
        // Genera un ID simulado ÚNICO para este creador
        const simulatedUniqueAccountId = `sim_acct_${crypto.randomBytes(8).toString('hex')}`;
        // --- 👆 FIN DE FIX 2 👆 ---
        
        await prisma.creator.update({
          where: { id: creator.id },
          data: { 
            stripeAccountOnboarded: true, 
            stripeAccountId: simulatedUniqueAccountId // <-- Usar el ID único
          },
        });

        reply.send({ onboarding_url: simulatedStripeUrl });

      } catch (err) {
        // Este catch ahora solo se activará por errores REALES.
        fastify.log.error("❌ Error en /creators/stripe-onboarding (Simulado):", err);
        reply.code(500).send({ error: "Error al simular el link de Stripe Connect" });
      }
    }
  );

  // --- RUTA (S3): Actualizar el contrato Premium. ---
  fastify.post(
    "/creators/:creatorId/update-contract",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { creatorId } = req.params;
      const { premiumContract } = req.body; 

      if (req.user.id !== creatorId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      const MAX_LENGTH = 120;
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

  // --- RUTA NUEVA: Para guardar la preferencia temática del creador (E4) ---
  fastify.post(
    "/creators/:creatorId/update-topic",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { creatorId } = req.params;
      const { topicPreference } = req.body; 

      if (req.user.id !== creatorId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      const MAX_LENGTH = 100; 

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

  // --- RUTA (GET /dashboard/:dashboardId/chats) ---
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
              take: 1, 
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
        
        formatted.sort((a, b) => {
            const scoreA = a.previewMessage?.priorityScore || 0;
            const scoreB = b.previewMessage?.priorityScore || 0;
            
            if (scoreA !== scoreB) {
                return scoreB - scoreA; 
            }
            
            const dateA = new Date(a.previewMessage?.createdAt || a.createdAt).getTime();
            const dateB = new Date(b.previewMessage?.createdAt || b.createdAt).getTime();
            return dateB - dateA;
        });
        
        reply.send(formatted); 
      
      } catch (err) {
        fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats:", err);
        reply.code(500).send({ error: "Error obteniendo chats" });
      }
    }
  );
}

module.exports = creatorsRoutes;