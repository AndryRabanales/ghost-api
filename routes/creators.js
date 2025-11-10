// andryrabanales/ghost-api/ghost-api-ccf8c4209b8106a049818e3cd23d69e44883da4e/routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const livesUtils = require('../utils/lives'); 

// --- AÑADIDO: Importar Stripe ---
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function creatorsRoutes(fastify, opts) {
  
  // ... (ruta POST /creators sin cambios) ...
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

  // ... (ruta GET /creators/me con cálculo de balance, sin cambios) ...
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
        pendingBalance: pendingBalance
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });
  
  // --- INICIO DE LA NUEVA RUTA ---
  /**
   * Ruta: POST /creators/stripe-onboarding
   * Crea o actualiza una cuenta de Stripe Connect y devuelve un link
   * para que el usuario complete su registro (onboarding).
   */
  fastify.post(
    "/creators/stripe-onboarding",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        if (!creator) {
          return reply.code(404).send({ error: "Creador no encontrado" });
        }

        let stripeAccountId = creator.stripeAccountId;
        let account;

        // 1. Si el creador NO tiene un ID de Stripe, creamos una cuenta Express
        if (!stripeAccountId) {
          account = await stripe.accounts.create({
            type: 'express',
            email: creator.email,
            metadata: {
              creatorId: creator.id,
            },
          });
          stripeAccountId = account.id;

          // Guardamos el nuevo ID en nuestra base de datos
          await prisma.creator.update({
            where: { id: creator.id },
            data: { stripeAccountId: stripeAccountId },
          });
          fastify.log.info(`Nueva cuenta de Stripe Connect creada: ${stripeAccountId}`);
        }

        // 2. Creamos un Link de Onboarding para esa cuenta
        const accountLink = await stripe.accountLinks.create({
          account: stripeAccountId,
          refresh_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}?stripe_onboarding=refresh`,
          return_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}?stripe_onboarding=success`,
          type: 'account_onboarding',
        });

        // 3. Devolvemos la URL del link al frontend
        reply.send({ onboarding_url: accountLink.url });

      } catch (err) {
        fastify.log.error("❌ Error en /creators/stripe-onboarding:", err);
        reply.code(500).send({ error: "Error al crear el link de Stripe Connect", details: err.message });
      }
    }
  );
  // --- FIN DE LA NUEVA RUTA ---

  // ... (ruta GET /dashboard/:dashboardId/chats sin cambios) ...
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
          orderBy: { createdAt: "desc" }, 
          include: {
            messages: {
              // Obtener el ÚLTIMO mensaje para la preview
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
          
        reply.send(formatted); 
      
      } catch (err) {
        fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats:", err);
        reply.code(500).send({ error: "Error obteniendo chats" });
      }
    }
  );
}

module.exports = creatorsRoutes;