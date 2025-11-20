// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function creatorsRoutes(fastify, opts) {
  
  // 1. CREAR CREADOR (Registro)
  fastify.post("/creators", async (req, reply) => {
    try {
      const { name } = req.body;
      if (!name) return reply.code(400).send({ error: "El nombre es obligatorio" });
      
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
      reply.code(500).send({ error: "Error creando creator" });
    }
  });

  // 2. OBTENER PERFIL (ME) - CON CÁLCULO DE SALDOS
  fastify.get("/creators/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      let creator = null;
      if (req.user.id && req.user.id !== "null") {
        creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
      } else if (req.user.publicId && req.user.publicId !== "null") {
        creator = await prisma.creator.findUnique({ where: { publicId: req.user.publicId } });
      }
      if (!creator) return reply.code(404).send({ error: "Creator no encontrado" });

      // Auto-validación Stripe
      if (creator.stripeAccountId && !creator.stripeAccountOnboarded) {
          try {
              const account = await stripe.accounts.retrieve(creator.stripeAccountId);
              if (account.details_submitted) {
                  creator = await prisma.creator.update({
                      where: { id: creator.id },
                      data: { stripeAccountOnboarded: true }
                  });
                  fastify.log.info(`✅ (Auto-Fix) Cuenta Stripe lista: ${creator.name}`);
              }
          } catch (stripeErr) {
             // Ignorar error si la cuenta no existe
          }
      }

      // --- CÁLCULO DE BALANCES ---
      
      // 1. Disponible (Ya en Stripe del creador - CAJA VERDE)
      const balance = await prisma.chatMessage.aggregate({
        _sum: { tipAmount: true },
        where: { chat: { creatorId: creator.id }, tipStatus: 'FULFILLED', from: 'anon' },
      });

      // 2. En Proceso (Esperando fondos del banco - CAJA AMARILLA)
      const processing = await prisma.chatMessage.aggregate({
        _sum: { tipAmount: true },
        where: { chat: { creatorId: creator.id }, tipStatus: 'PROCESSING', from: 'anon' },
      });

      // 3. Pendiente (Falta contestar - CAJA MORADA)
      const pending = await prisma.chatMessage.aggregate({
        _sum: { tipAmount: true },
        where: { chat: { creatorId: creator.id }, tipStatus: 'PENDING', from: 'anon' },
      });

      reply.send({
        id: creator.id,
        name: creator.name,
        email: creator.email,
        publicId: creator.publicId,
        
        stripeAccountId: creator.stripeAccountId, 
        stripeAccountOnboarded: creator.stripeAccountOnboarded,
        
        // Saldos para el frontend
        availableBalance: balance._sum.tipAmount || 0,
        processingBalance: processing._sum.tipAmount || 0,
        pendingBalance: pending._sum.tipAmount || 0,
        
        baseTipAmountCents: creator.baseTipAmountCents,
        topicPreference: creator.topicPreference
        // ❌ premiumContract ELIMINADO
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil" });
    }
  });
  
  // 3. STRIPE ONBOARDING
  fastify.post("/creators/stripe-onboarding", { preHandler: [fastify.authenticate] }, async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        
        // Limpieza preventiva
        if (creator.stripeAccountId?.startsWith('sim_')) {
             await prisma.creator.update({ where: { id: creator.id }, data: { stripeAccountId: null, stripeAccountOnboarded: false }});
             creator.stripeAccountId = null;
        }

        if (creator.stripeAccountId) {
            try {
                if (creator.stripeAccountOnboarded) {
                     const loginLink = await stripe.accounts.createLoginLink(creator.stripeAccountId);
                     return reply.send({ onboarding_url: loginLink.url });
                }
                const accountLink = await stripe.accountLinks.create({
                    account: creator.stripeAccountId,
                    refresh_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}`,
                    return_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}?onboarding=success`,
                    type: 'account_onboarding',
                });
                return reply.send({ onboarding_url: accountLink.url });
            } catch (stripeErr) {
                if (stripeErr.code === 'account_invalid' || stripeErr.message.includes('No such account')) {
                    await prisma.creator.update({ where: { id: creator.id }, data: { stripeAccountId: null, stripeAccountOnboarded: false }});
                    creator.stripeAccountId = null;
                } else { throw stripeErr; }
            }
        }

        if (!creator.stripeAccountId) {
            const account = await stripe.accounts.create({
                type: 'express', country: 'MX', email: creator.email,
                capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
            });
            await prisma.creator.update({ where: { id: creator.id }, data: { stripeAccountId: account.id } });
            creator.stripeAccountId = account.id;
        }

        const accountLink = await stripe.accountLinks.create({
            account: creator.stripeAccountId,
            refresh_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}`,
            return_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}?onboarding=success`,
            type: 'account_onboarding',
        });
        reply.send({ onboarding_url: accountLink.url });

      } catch (err) {
        reply.code(500).send({ error: "Error al conectar con Stripe: " + err.message });
      }
    }
  );

  // 4. STRIPE DASHBOARD
  fastify.post("/creators/stripe-dashboard", { preHandler: [fastify.authenticate] }, async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        if (!creator.stripeAccountId) return reply.code(400).send({ error: "Cuenta no configurada." });
        const loginLink = await stripe.accounts.createLoginLink(creator.stripeAccountId);
        reply.send({ url: loginLink.url });
      } catch (err) {
        await prisma.creator.update({ where: { id: req.user.id }, data: { stripeAccountId: null, stripeAccountOnboarded: false } });
        return reply.code(400).send({ error: "Conexión inestable. Por favor reconecta tu cuenta." });
      }
    }
  );

  // 5. HELPER PARA ACTUALIZAR CONFIGURACIONES
  const updateSettings = async (req, reply, field) => {
      const { creatorId } = req.params;
      if (req.user.id !== creatorId) return reply.code(403).send({ error: "No autorizado" });
      
      const value = req.body[field]; 
      
      try {
        const updated = await prisma.creator.update({ where: { id: creatorId }, data: { [field]: value } });
        fastify.broadcastToPublic(updated.publicId, { type: 'CREATOR_INFO_UPDATE', [field]: value });
        reply.send({ success: true, [field]: value });
      } catch (e) { reply.code(500).send({ error: "Error actualizando configuración" }); }
  };

  // 6. RUTAS DE CONFIGURACIÓN
  // Solo queda Topic (Filtro IA) y Settings (Precio)
  fastify.post("/creators/:creatorId/update-topic", { preHandler: [fastify.authenticate] }, (req, r) => updateSettings(req, r, 'topicPreference'));
  fastify.post("/creators/:creatorId/settings", { preHandler: [fastify.authenticate] }, (req, r) => updateSettings(req, r, 'baseTipAmountCents'));

  // 8. LISTAR CHATS DEL DASHBOARD
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
        fastify.log.error("❌ Error en GET chats:", err);
        reply.code(500).send({ error: "Error obteniendo chats" });
      }
    }
  );
}

module.exports = creatorsRoutes;