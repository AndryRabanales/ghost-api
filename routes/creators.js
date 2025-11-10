// andryrabanales/ghost-api/ghost-api-ccf8c4209b8106a049818e3cd23d69e44883da4e/routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const livesUtils = require('../utils/lives'); 

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

  // ... (ruta GET /creators/me con cálculo de balance - sin cambios) ...
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
  
  // --- INICIO DE LA RUTA MODIFICADA (SIMULADA) ---
  /**
   * Ruta: POST /creators/stripe-onboarding (Simulada)
   * Devuelve una URL falsa de onboarding para probar el flujo.
   */
  fastify.post(
    "/creators/stripe-onboarding",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        // 1. Verificamos que el creador exista
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        if (!creator) {
          return reply.code(404).send({ error: "Creador no encontrado" });
        }

        fastify.log.info(`✅ (SIMULADO) Link de Onboarding generado para ${creator.id}`);

        // 2. Devolvemos una URL de Stripe falsa (simulada)
        // Usamos una URL real de Stripe para que la redirección parezca legítima
        const simulatedStripeUrl = "https://connect.stripe.com/setup/s/simulated-onboarding-link";
        
        // 3. (Importante para la simulación) Marcamos al usuario como "onboarded" en nuestra DB
        //    para que la próxima vez que cargue el dashboard, vea el cambio.
        await prisma.creator.update({
          where: { id: creator.id },
          // Simulamos que el onboarding fue exitoso
          data: { 
            stripeAccountOnboarded: true, 
            stripeAccountId: "sim_acct_12345" // Un ID falso para simular
          },
        });

        // 4. Enviamos la URL falsa
        reply.send({ onboarding_url: simulatedStripeUrl });

      } catch (err) {
        fastify.log.error("❌ Error en /creators/stripe-onboarding (Simulado):", err);
        reply.code(500).send({ error: "Error al simular el link de Stripe Connect" });
      }
    }
  );
  // --- FIN DE LA RUTA MODIFICADA ---

  // ... (ruta GET /dashboard/:dashboardId/chats - sin cambios) ...
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