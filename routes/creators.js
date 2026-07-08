// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const livesUtils = require('../utils/lives');
const { sanitize } = require("../utils/sanitize");

// Stripe eliminado

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

      const pendingBalance = 0;

      reply.send({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        publicId: updated.publicId,
        aliasPrompt: updated.aliasPrompt,
        messagePrompt: updated.messagePrompt,
        lives: updated.lives,
        maxLives: updated.maxLives,
        minutesToNextLife: livesUtils.minutesToNextLife(updated),
        pendingBalance: pendingBalance
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });

  // --- RUTA PATCH /creators/me (Editar perfil) ---
  fastify.patch("/creators/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      const creator = await prisma.creator.findUnique({ where: { id: req.user.id } });
      if (!creator) return reply.code(404).send({ error: "Creator no encontrado" });

      const data = {};

      if (req.body.name !== undefined) {
        const name = sanitize(req.body.name);
        if (!name || name.trim().length < 1) {
          return reply.code(400).send({ error: "El nombre no puede estar vacío." });
        }
        data.name = name.trim().slice(0, 40);
      }

      if (req.body.aliasPrompt !== undefined) {
        const v = sanitize(req.body.aliasPrompt);
        data.aliasPrompt = v ? v.trim().slice(0, 80) : null;
      }

      if (req.body.messagePrompt !== undefined) {
        const v = sanitize(req.body.messagePrompt);
        data.messagePrompt = v ? v.trim().slice(0, 120) : null;
      }

      const updated = await prisma.creator.update({
        where: { id: creator.id },
        data,
      });

      reply.send({
        id: updated.id,
        name: updated.name,
        publicId: updated.publicId,
        aliasPrompt: updated.aliasPrompt,
        messagePrompt: updated.messagePrompt,
      });
    } catch (err) {
      fastify.log.error("❌ Error en PATCH /creators/me:", err);
      reply.code(500).send({ error: "Error actualizando el perfil" });
    }
  });



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
        fastify.log.error("❌ Error en GET chats:", err);
        reply.code(500).send({ error: "Error obteniendo chats" });
      }
    }
  );
}

module.exports = creatorsRoutes;