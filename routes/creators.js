const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
// 👇 IMPORTANTE: Inicializar Stripe con tu clave secreta del .env
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function creatorsRoutes(fastify, opts) {
  
  // 1. CREAR CREADOR (Registro) - Limpio de vidas
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
          // ❌ Eliminados: lives, maxLives, lastUpdated
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

  // 2. OBTENER PERFIL (ME)
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

      // Lógica de expiración de Premium (Se mantiene)
      if (creator.isPremium && creator.premiumExpiresAt && new Date() > new Date(creator.premiumExpiresAt)) {
        creator = await prisma.creator.update({
          where: { id: creator.id },
          data: { isPremium: false, subscriptionStatus: 'expired' }
        });
        fastify.log.info(`La suscripción Premium para ${creator.id} ha expirado.`);
      }
 
      // Cálculo de Balance
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
        id: creator.id,
        name: creator.name,
        email: creator.email,
        publicId: creator.publicId,
        isPremium: creator.isPremium,
        stripeAccountId: creator.stripeAccountId, 
        stripeAccountOnboarded: creator.stripeAccountOnboarded,
        availableBalance: availableBalance,
        pendingBalance: pendingBalance,
        premiumContract: creator.premiumContract || "Respuesta de alta calidad.",
        baseTipAmountCents: creator.baseTipAmountCents,
        topicPreference: creator.topicPreference || "Cualquier mensaje respetuoso."
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });
  
  // 3. STRIPE ONBOARDING (REAL - STRIPE CONNECT EXPRESS)
  fastify.post(
    "/creators/stripe-onboarding",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });

        // A. Si ya tiene cuenta y está "onboarded", generamos un link de LOGIN a su panel
        // (Esto es útil si vuelven a dar clic en "Configurar", pero lo ideal es usar la ruta de dashboard abajo)
        if (creator.stripeAccountOnboarded && creator.stripeAccountId) {
            const loginLink = await stripe.accounts.createLoginLink(creator.stripeAccountId);
            return reply.send({ onboarding_url: loginLink.url }); // Reutilizamos el campo para redirigir
        }

        // B. Si no tiene cuenta, CREAMOS una cuenta Express
        let accountId = creator.stripeAccountId;
        if (!accountId) {
            const account = await stripe.accounts.create({
                type: 'express',
                country: 'MX', // ⚠️ Ajusta esto dinámicamente si tienes usuarios de otros países
                email: creator.email,
                capabilities: {
                  card_payments: { requested: true },
                  transfers: { requested: true },
                },
            });
            accountId = account.id;

            // Guardamos el ID en la base de datos
            await prisma.creator.update({
                where: { id: creator.id },
                data: { stripeAccountId: accountId }
            });
        }

        // C. Generamos el enlace para que llene sus datos en Stripe
        const accountLink = await stripe.accountLinks.create({
            account: accountId,
            // URL si el usuario cancela o falla el proceso
            refresh_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}`, 
            // URL cuando el usuario completa el proceso con éxito
            return_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}?onboarding=success`, 
            type: 'account_onboarding',
        });

        // Devolvemos la URL para que el frontend redirija
        reply.send({ onboarding_url: accountLink.url });

      } catch (err) {
        fastify.log.error("❌ Error en Stripe Onboarding:", err);
        reply.code(500).send({ error: "Error al conectar con Stripe." });
      }
    }
  );

  // 4. NUEVA RUTA: DASHBOARD DE STRIPE (Para ver ganancias / "Billetera")
  fastify.post(
    "/creators/stripe-dashboard",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        
        if (!creator.stripeAccountId) {
            return reply.code(400).send({ error: "Cuenta no configurada. Por favor configura tus pagos primero." });
        }

        // Genera un link temporal de un solo uso para entrar al panel de Stripe Express
        const loginLink = await stripe.accounts.createLoginLink(creator.stripeAccountId);
        
        reply.send({ url: loginLink.url });
      } catch (err) {
        fastify.log.error("❌ Error generando link del dashboard Stripe:", err);
        reply.code(500).send({ error: "No se pudo acceder al panel de pagos." });
      }
    }
  );

  // 5. ACTUALIZAR CONTRATO
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

  // 6. ACTUALIZAR TEMA (TOPIC)
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
  
  // 7. ACTUALIZAR PRECIO BASE
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

  // 8. LISTAR CHATS DEL DASHBOARD
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