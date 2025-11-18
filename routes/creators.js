// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const livesUtils = require('../utils/lives'); 
const { sanitize } = require("../utils/sanitize");

// --- 1. IMPORTAR STRIPE ---
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function creatorsRoutes(fastify, opts) {
  
  // --- RUTA POST /creators (Crear cuenta inicial) ---
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

  // --- RUTA GET /creators/me (Obtener perfil y balance) ---
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

      // --- Lógica de Expiración Premium ---
      if (creator.isPremium && creator.premiumExpiresAt && new Date() > new Date(creator.premiumExpiresAt)) {
        creator = await prisma.creator.update({
          where: { id: creator.id },
          data: { isPremium: false, subscriptionStatus: 'expired' }
        });
        fastify.log.info(`La suscripción Premium para ${creator.id} ha expirado.`);
      }
 
      // --- Lógica de Vidas ---
      const updated = await livesUtils.refillLivesIfNeeded(creator);

      // --- Cálculo de Balance ---
      // Solo sumamos 'FULFILLED' para el balance disponible
      const availableBalanceResult = await prisma.chatMessage.aggregate({
        _sum: { tipAmount: true },
        where: {
          chat: { creatorId: creator.id },
          tipStatus: 'FULFILLED', // Solo lo que ya se respondió y no se ha pagado
          from: 'anon'
        },
      });
      
      // Balance pendiente (aún no respondido)
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
        baseTipAmountCents: updated.baseTipAmountCents,
        topicPreference: updated.topicPreference || "Cualquier mensaje respetuoso."
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });
  
  // --- RUTA REAL: STRIPE ONBOARDING (EXPRESS) ---
  fastify.post(
    "/creators/stripe-onboarding",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });

        let accountId = creator.stripeAccountId;

        // 1. Si no tiene cuenta de Stripe, creamos una (Express)
        if (!accountId) {
          const account = await stripe.accounts.create({
            type: 'express',
            country: 'MX', // Ajusta según tu país principal ('US', 'ES', etc.)
            email: creator.email,
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true },
            },
          });
          accountId = account.id;

          // Guardamos el ID real en la BD
          await prisma.creator.update({
            where: { id: creator.id },
            data: { stripeAccountId: accountId },
          });
        }

        // 2. Generamos el link de onboarding de Stripe
        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}?stripe=refresh`,
          return_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}?stripe=return`,
          type: 'account_onboarding',
        });

        // 3. Devolvemos la URL real
        reply.send({ onboarding_url: accountLink.url });

      } catch (err) {
        fastify.log.error("❌ Error en Stripe Onboarding:", err);
        reply.code(500).send({ error: "Error al conectar con Stripe." });
      }
    }
  );

  // --- RUTA REAL: RETIRAR FONDOS (PAYOUT) ---
  fastify.post(
    "/creators/payout",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creatorId = req.user.id;
        const creator = await prisma.creator.findUnique({ where: { id: creatorId } });

        if (!creator.stripeAccountId || !creator.stripeAccountOnboarded) {
            return reply.code(400).send({ error: "No tienes una cuenta bancaria conectada." });
        }

        // 1. Calcular saldo disponible REAL
        const payableMessages = await prisma.chatMessage.findMany({
            where: {
                chat: { creatorId: creatorId },
                tipStatus: 'FULFILLED', // Solo mensajes respondidos
                from: 'anon'
            }
        });
        
        const amountToPay = payableMessages.reduce((sum, msg) => sum + (msg.tipAmount || 0), 0);
        
        // Mínimo 50 pesos para transferir (Stripe tiene límites mínimos)
        if (amountToPay < 50) { 
             return reply.code(400).send({ error: "El saldo mínimo para retirar es $50 MXN." });
        }

        // 2. Transferencia a la cuenta conectada
        const transfer = await stripe.transfers.create({
          amount: Math.floor(amountToPay * 100), // Stripe usa centavos
          currency: "mxn",
          destination: creator.stripeAccountId,
        });

        // 3. MARCAR MENSAJES COMO PAGADOS
        // Usamos 'PAID_OUT' (asegúrate de que tu frontend no muestre esto como pendiente)
        // O alternativamente, usa un campo 'payoutId' si prefieres no cambiar el status.
        const messageIds = payableMessages.map(m => m.id);
        
        // Nota: Si usas Enum en Prisma para tipStatus, debes agregar 'PAID_OUT' al schema primero.
        // Si es String, esto funciona directo.
        await prisma.chatMessage.updateMany({
            where: { id: { in: messageIds } },
            data: { tipStatus: 'PAID_OUT' } 
        });

        fastify.log.info(`💸 Payout exitoso de $${amountToPay} a ${creatorId}`);
        reply.send({ success: true, amount: amountToPay, transferId: transfer.id });

      } catch (err) {
        fastify.log.error("❌ Error en Payout:", err);
        reply.code(500).send({ error: err.message || "Error procesando el retiro." });
      }
    }
  );

  // --- RUTA AUXILIAR: Verificar estado de Stripe ---
  // Sirve para que el frontend sepa si cambiar el botón de "Configurar" a "Retirar"
  fastify.get("/creators/stripe-status", { preHandler: [fastify.authenticate] }, async (req, reply) => {
      try {
          const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
          if(!creator.stripeAccountId) return reply.send({ onboarded: false });
          
          const account = await stripe.accounts.retrieve(creator.stripeAccountId);
          const isOnboarded = account.charges_enabled; // Si true, ya puede cobrar
          
          if (isOnboarded && !creator.stripeAccountOnboarded) {
              await prisma.creator.update({
                  where: { id: creator.id },
                  data: { stripeAccountOnboarded: true }
              });
          }
          
          reply.send({ onboarded: isOnboarded });
      } catch(err) {
          reply.send({ onboarded: false });
      }
  });

  // --- RUTA: Actualizar contrato (Sin cambios) ---
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
        return reply.code(400).send({ error: "Datos de contrato inválidos o exceden el límite." });
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

  // --- RUTA: Guardar preferencia de tema (Sin cambios) ---
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
        return reply.code(400).send({ error: `La preferencia de tema excede los ${MAX_LENGTH} caracteres.` });
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
        fastify.log.error("❌ Error al actualizar tema:", err);
        reply.code(500).send({ error: "Error interno al guardar el tema." });
      }
    }
  );
  
  // --- RUTA: Guardar precio base (Sin cambios) ---
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
        fastify.log.error("❌ Error al actualizar precio:", err);
        reply.code(500).send({ error: "Error interno al guardar el precio." });
      }
    }
  );

  // --- RUTA GET /dashboard/chats (Listar chats) ---
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
        
        // Ordenar por prioridad ($) y luego por fecha
        formatted.sort((a, b) => {
            const scoreA = a.previewMessage?.priorityScore || 0;
            const scoreB = b.previewMessage?.priorityScore || 0;
            
            if (scoreA !== scoreB) return scoreB - scoreA; 
            
            const dateA = new Date(a.previewMessage?.createdAt || a.createdAt).getTime();
            const dateB = new Date(b.previewMessage?.createdAt || b.createdAt).getTime();
            return dateB - dateA;
        });
        
        reply.send(formatted); 
      
      } catch (err) {
        fastify.log.error("❌ Error en GET chatsss:", err);
        reply.code(500).send({ error: "Error obteniendo chats" });
      }
    }
  );
}

module.exports = creatorsRoutes;