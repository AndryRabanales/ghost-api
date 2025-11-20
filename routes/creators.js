// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
// 👇 IMPORTANTE: Inicializar Stripe con tu clave secreta del .env
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

  // 2. OBTENER PERFIL (ME) - CON AUTO-VALIDACIÓN DE STRIPE
  fastify.get("/creators/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      let creator = null;
      if (req.user.id && req.user.id !== "null") {
        creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
      } else if (req.user.publicId && req.user.publicId !== "null") {
        creator = await prisma.creator.findUnique({ where: { publicId: req.user.publicId } });
      }
      if (!creator) return reply.code(404).send({ error: "Creator no encontrado" });

      // 👇 AUTO-CHECK: Si tiene cuenta pero dice "no listo", preguntamos a Stripe
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
             // Si la cuenta no existe (por cambio de claves), no hacemos nada aquí.
          }
      }

      // Cálculo de Balance
      const balance = await prisma.chatMessage.aggregate({
        _sum: { tipAmount: true },
        where: { chat: { creatorId: creator.id }, tipStatus: 'FULFILLED', from: 'anon' },
      });
      const pending = await prisma.chatMessage.aggregate({
        _sum: { tipAmount: true },
        where: { chat: { creatorId: creator.id }, tipStatus: 'PENDING', from: 'anon' },
      });

      reply.send({
        id: creator.id,
        name: creator.name,
        email: creator.email,
        publicId: creator.publicId,
        isPremium: creator.isPremium,
        stripeAccountId: creator.stripeAccountId, 
        stripeAccountOnboarded: creator.stripeAccountOnboarded,
        availableBalance: balance._sum.tipAmount || 0,
        pendingBalance: pending._sum.tipAmount || 0,
        premiumContract: creator.premiumContract,
        baseTipAmountCents: creator.baseTipAmountCents,
        topicPreference: creator.topicPreference
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil" });
    }
  });
  
  // 3. STRIPE ONBOARDING (BLINDADO Y AUTO-REPARABLE)
  fastify.post(
    "/creators/stripe-onboarding",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        
        // 1. Limpieza preventiva de cuentas simuladas
        if (creator.stripeAccountId?.startsWith('sim_')) {
             await prisma.creator.update({ where: { id: creator.id }, data: { stripeAccountId: null, stripeAccountOnboarded: false }});
             creator.stripeAccountId = null;
        }

        // 2. Si ya tiene cuenta, intentamos generar link de onboarding (o login si ya acabó)
        if (creator.stripeAccountId) {
            try {
                // Si ya está listo, mandamos login directo
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
                // 🔥 SI FALLA (Cuenta inválida/borrada), LA BORRAMOS Y SEGUIMOS
                if (stripeErr.code === 'account_invalid' || stripeErr.message.includes('No such account')) {
                    fastify.log.warn(`⚠️ Cuenta inválida detectada (${creator.stripeAccountId}). Creando una nueva...`);
                    await prisma.creator.update({ where: { id: creator.id }, data: { stripeAccountId: null, stripeAccountOnboarded: false }});
                    creator.stripeAccountId = null; // Reset local
                } else {
                    throw stripeErr; // Otro error real
                }
            }
        }

        // 3. Crear cuenta nueva (si no tenía o se borró arriba)
        if (!creator.stripeAccountId) {
            const account = await stripe.accounts.create({
                type: 'express',
                country: 'MX', 
                email: creator.email,
                capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
            });
            await prisma.creator.update({ where: { id: creator.id }, data: { stripeAccountId: account.id } });
            creator.stripeAccountId = account.id;
        }

        // 4. Generar link para la cuenta nueva
        const accountLink = await stripe.accountLinks.create({
            account: creator.stripeAccountId,
            refresh_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}`,
            return_url: `${process.env.FRONTEND_URL}/dashboard/${creator.id}?onboarding=success`,
            type: 'account_onboarding',
        });

        reply.send({ onboarding_url: accountLink.url });

      } catch (err) {
        fastify.log.error("❌ Error Stripe Onboarding:", err);
        reply.code(500).send({ error: "Error al conectar con Stripe: " + err.message });
      }
    }
  );

  // 4. STRIPE DASHBOARD (Ver Billetera)
  fastify.post(
    "/creators/stripe-dashboard",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
        
        if (!creator.stripeAccountId) return reply.code(400).send({ error: "Cuenta no configurada." });

        const loginLink = await stripe.accounts.createLoginLink(creator.stripeAccountId);
        reply.send({ url: loginLink.url });

      } catch (err) {
        // Auto-reparación si la cuenta no existe
        if (err.code === 'account_invalid' || err.message.includes('No such account')) {
             await prisma.creator.update({ where: { id: req.user.id }, data: { stripeAccountId: null, stripeAccountOnboarded: false }});
             return reply.code(400).send({ error: "Tu cuenta necesita reconectarse." });
        }
        reply.code(500).send({ error: "Error abriendo panel: " + err.message });
      }
    }
  );

  // 5. HELPER PARA ACTUALIZAR CONFIGURACIONES (DRY)
  const updateSettings = async (req, reply, field) => {
      const { creatorId } = req.params;
      if (req.user.id !== creatorId) return reply.code(403).send({ error: "No autorizado" });
      
      const value = req.body[field]; 
      
      try {
        const updated = await prisma.creator.update({
            where: { id: creatorId },
            data: { [field]: value }
        });
        // Notificar en tiempo real
        fastify.broadcastToPublic(updated.publicId, { type: 'CREATOR_INFO_UPDATE', [field]: value });
        reply.send({ success: true, [field]: value });
      } catch (e) { 
          fastify.log.error(e);
          reply.code(500).send({ error: "Error actualizando configuración" }); 
      }
  };

  // 6. RUTAS DE CONFIGURACIÓN (Usando el helper)
  fastify.post("/creators/:creatorId/update-contract", { preHandler: [fastify.authenticate] }, (req, r) => updateSettings(req, r, 'premiumContract'));
  fastify.post("/creators/:creatorId/update-topic", { preHandler: [fastify.authenticate] }, (req, r) => updateSettings(req, r, 'topicPreference'));
  fastify.post("/creators/:creatorId/settings", { preHandler: [fastify.authenticate] }, (req, r) => updateSettings(req, r, 'baseTipAmountCents'));

  // 8. LISTAR CHATS DEL DASHBOARD
  fastify.get(
    "/dashboard/:dashboardId/chats",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
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