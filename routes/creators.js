// andryrabanales/ghost-api/ghost-api-abfc35e2f3750c5ab2764fb71701208dc948b301/routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const livesUtils = require('../utils/lives'); 
const { sanitize } = require("../utils/sanitize"); // Necesario para sanitizar el contrato (S3)

// --- ELIMINADO: No importamos Stripe para la simulación ---
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
  // Incluye el cálculo de balance (P1, P2), estado Premium y vidas.
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

      // --- CÁLCULO DE BALANCE (P1, P2) ---
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
        // S3: Incluimos el contrato para el componente de configuración
        premiumContract: updated.premiumContract || "Respuesta de alta calidad." 
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });
  
  // --- RUTA (P5): SIMULACIÓN DE STRIPE ONBOARDING ---
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
        
        // Simulamos que el onboarding fue exitoso
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
  fastify.post(
    "/creators/:creatorId/update-contract",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { creatorId } = req.params;
      const { premiumContract } = req.body; // <-- FIX 1: Destructure the string

      if (req.user.id !== creatorId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      // FIX 2: Validate the string itself
      if (typeof premiumContract !== 'string') { 
        return reply.code(400).send({ error: "Datos de contrato inválidos, se esperaba un string." });
      }

      try {
        // Sanitize the input before saving (Good Practice)
        const cleanContract = sanitize(premiumContract);

        const updatedCreator = await prisma.creator.update({
          where: { id: creatorId },
          data: { premiumContract: cleanContract }, // <-- FIX 3: Use the string variable
          select: { premiumContract: true, publicId: true } 
        });

        // --- AÑADIDO (S3): BROADCAST DE ACTUALIZACIÓN DE CONTRATO (CLAVE) ---
        fastify.broadcastToPublic(updatedCreator.publicId, {
            type: 'CREATOR_INFO_UPDATE',
            premiumContract: updatedCreator.premiumContract,
        });
        // --- FIN AÑADIDO ---

        reply.send({ premiumContract: updatedCreator.premiumContract });
      } catch (err) {
        fastify.log.error("❌ Error al actualizar contrato:", err);
        reply.code(500).send({ error: "Error interno al guardar el contrato." });
      }
    }
  );

  // --- RUTA (GET /dashboard/:dashboardId/chats) ---
  // Incluye la Priorización por Precio (S6).
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
          // Quitamos el orderBy por createdAt en el root query para hacerlo en JS
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
          anonReplied: chat.anonReplied, // Campo clave para la notificación
          createdAt: chat.createdAt,
          previewMessage: chat.messages[0] || null // El último mensaje
        }));
        
        // --- IMPLEMENTACIÓN S6: Ordenar por Monto de Propina (Prioridad) ---
        formatted.sort((a, b) => {
            // 1. Obtener la propina del último mensaje (usamos 0 si no hay o es null)
            const tipA = a.previewMessage?.tipAmount || 0;
            const tipB = b.previewMessage?.tipAmount || 0;
            
            // Prioridad principal: Monto de propina (mayor a menor)
            if (tipA !== tipB) {
                return tipB - tipA; // Mayor propina primero
            }
            
            // Prioridad secundaria: Fecha del último mensaje (más reciente primero)
            const dateA = new Date(a.previewMessage?.createdAt || a.createdAt).getTime();
            const dateB = new Date(b.previewMessage?.createdAt || b.createdAt).getTime();
            return dateB - dateA; // Más reciente primero
        });
        // --- FIN IMPLEMENTACIÓN S6 ---
        
        reply.send(formatted); 
      
      } catch (err) {
        fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats:", err);
        reply.code(500).send({ error: "Error obteniendo chats" });
      }
    }
  );
}

module.exports = creatorsRoutes;