// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function creatorsRoutes(fastify, opts) {
  
  // 1. CREAR CREADOR
  fastify.post("/creators", async (req, reply) => {
    try {
      const { name } = req.body;
      if (!name) return reply.code(400).send({ error: "Nombre obligatorio" });
      
      const dashboardId = crypto.randomUUID();
      const publicId = crypto.randomUUID();
      
      const creator = await prisma.creator.create({
        data: { id: dashboardId, publicId, name },
      });

      const token = fastify.generateToken(creator);
      const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";

      reply.code(201).send({
        dashboardUrl: `${baseUrl}/dashboard/${dashboardId}`,
        publicUrl: `${baseUrl}/u/${publicId}`,
        dashboardId,
        publicId,
        token,
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error creando cuenta" });
    }
  });

  // 2. OBTENER PERFIL (ME) - CON AUTO-FIX DE STRIPE
  fastify.get("/creators/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      let creator = await prisma.creator.findUnique({ 
        where: req.user.id !== "null" ? { id: req.user.id } : { publicId: req.user.publicId } 
      });
      if (!creator) return reply.code(404).send({ error: "Creator no encontrado" });

      // Auto-Check Stripe
      if (creator.stripeAccountId && !creator.stripeAccountOnboarded) {
          try {
              const account = await stripe.accounts.retrieve(creator.stripeAccountId);
              if (account.details_submitted) {
                  creator = await prisma.creator.update({
                      where: { id: creator.id },
                      data: { stripeAccountOnboarded: true }
                  });
              }
          } catch (e) {}
      }

      // Balances
      const balance = await prisma.chatMessage.aggregate({
        _sum: { tipAmount: true },
        where: { chat: { creatorId: creator.id }, from: 'anon' }
      });
      // Nota: Para simplificar MVP, aquí sumamos todo lo histórico o podrías filtrar por status
      // En producción real, Stripe gestiona el saldo "disponible", esto es solo "histórico ventas"
      
      const pending = await prisma.chatMessage.aggregate({
          _sum: { tipAmount: true },
          where: { chat: { creatorId: creator.id }, tipStatus: 'PENDING', from: 'anon' }
      });

      reply.send({
        id: creator.id,
        name: creator.name,
        email: creator.email,
        publicId: creator.publicId,
        stripeAccountId: creator.stripeAccountId, 
        stripeAccountOnboarded: creator.stripeAccountOnboarded,
        availableBalance: balance._sum.tipAmount || 0, // Total histórico
        pendingBalance: pending._sum.tipAmount || 0,   // Pendiente de respuesta
        premiumContract: creator.premiumContract,
        baseTipAmountCents: creator.baseTipAmountCents,
        topicPreference: creator.topicPreference
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error perfil" });
    }
  });
  
  // 3. STRIPE ONBOARDING
  fastify.post("/creators/stripe-onboarding", { preHandler: [fastify.authenticate] }, async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        
        // Reset cuentas simuladas
        if (creator.stripeAccountId?.startsWith('sim_')) {
             await prisma.creator.update({ where: { id: creator.id }, data: { stripeAccountId: null, stripeAccountOnboarded: false }});
             creator.stripeAccountId = null;
        }

        if (creator.stripeAccountOnboarded && creator.stripeAccountId) {
            const loginLink = await stripe.accounts.createLoginLink(creator.stripeAccountId);
            return reply.send({ onboarding_url: loginLink.url });
        }

        let accountId = creator.stripeAccountId;
        if (!accountId) {
            const account = await stripe.accounts.create({ type: 'express', country: 'MX', email: creator.email });
            accountId = account.id;
            await prisma.creator.update({ where: { id: creator.id }, data: { stripeAccountId: accountId } });
        }

        const accountLink = await stripe.accountLinks.create({
            account: accountId,
            refresh_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}`,
            return_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}?onboarding=success`,
            type: 'account_onboarding',
        });

        reply.send({ onboarding_url: accountLink.url });
      } catch (err) {
        reply.code(500).send({ error: err.message });
      }
  });

  // 4. STRIPE DASHBOARD
  fastify.post("/creators/stripe-dashboard", { preHandler: [fastify.authenticate] }, async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        if (!creator.stripeAccountId) return reply.code(400).send({ error: "Cuenta no configurada" });
        
        const loginLink = await stripe.accounts.createLoginLink(creator.stripeAccountId);
        reply.send({ url: loginLink.url });
      } catch (err) {
        reply.code(500).send({ error: "Error stripe dashboard" });
      }
  });

  // 5. ACTUALIZAR CONFIGURACIONES (Contrato, Tema, Precio)
  const updateSettings = async (req, reply, field) => {
      const { creatorId } = req.params;
      if (req.user.id !== creatorId) return reply.code(403).send({ error: "No autorizado" });
      
      const value = req.body[field];
      // Validaciones básicas...
      
      try {
        const updated = await prisma.creator.update({
            where: { id: creatorId },
            data: { [field]: value }
        });
        // Notificar websocket público
        fastify.broadcastToPublic(updated.publicId, { type: 'CREATOR_INFO_UPDATE', [field]: value });
        reply.send({ success: true, [field]: value });
      } catch (e) { reply.code(500).send({ error: "Error actualizando" }); }
  };

  fastify.post("/creators/:creatorId/update-contract", { preHandler: [fastify.authenticate] }, (req, reply) => updateSettings(req, reply, 'premiumContract'));
  fastify.post("/creators/:creatorId/update-topic", { preHandler: [fastify.authenticate] }, (req, reply) => updateSettings(req, reply, 'topicPreference'));
  fastify.post("/creators/:creatorId/settings", { preHandler: [fastify.authenticate] }, (req, reply) => updateSettings(req, reply, 'baseTipAmountCents'));

  // 8. LISTAR CHATS (DASHBOARD)
  fastify.get("/dashboard/:dashboardId/chats", { preHandler: [fastify.authenticate] }, async (req, reply) => {
      try {
        const { dashboardId } = req.params;
        if (req.user.id !== dashboardId) return reply.code(403).send({ error: "No autorizado" });
  
        const chats = await prisma.chat.findMany({
          where: { creatorId: dashboardId },
          include: {
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
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
        
        // Ordenar: Prioridad primero ($$$), luego fecha
        formatted.sort((a, b) => {
            const scoreA = a.previewMessage?.priorityScore || 0;
            const scoreB = b.previewMessage?.priorityScore || 0;
            if (scoreA !== scoreB) return scoreB - scoreA; 
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        
        reply.send(formatted); 
      } catch (err) {
        reply.code(500).send({ error: "Error chats" });
      }
  });
}

module.exports = creatorsRoutes;