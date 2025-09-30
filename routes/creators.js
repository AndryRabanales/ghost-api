// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

// Configuración de vidas
const LIFE_INTERVAL = 15 * 60 * 1000; // 15 minutos
const MAX_LIVES = 6;

/**
 * Calcula cuántos minutos faltan para la siguiente vida.
 */
function minutesToNextLife(creator) {
  if (creator.lives >= MAX_LIVES) return 0;
  if (!creator.lastRefillAt) return 0;

  const now = Date.now();
  const last = new Date(creator.lastRefillAt).getTime();
  const elapsed = now - last;

  const remaining = LIFE_INTERVAL - (elapsed % LIFE_INTERVAL);
  return Math.ceil(remaining / 60000);
}

/**
 * Revisa si corresponde recargar vidas automáticamente.
 */
async function refillLives(creator) {
  if (creator.lives >= MAX_LIVES) return creator;

  const now = Date.now();
  const last = creator.lastRefillAt
    ? new Date(creator.lastRefillAt).getTime()
    : 0;

  const elapsed = now - last;
  if (elapsed < LIFE_INTERVAL) return creator;

  const regenerated = Math.floor(elapsed / LIFE_INTERVAL);
  let newLives = creator.lives + regenerated;
  if (newLives > MAX_LIVES) newLives = MAX_LIVES;

  const updated = await prisma.creator.update({
    where: { id: creator.id },
    data: {
      lives: newLives,
      lastRefillAt: new Date(now - (elapsed % LIFE_INTERVAL)),
    },
  });

  return updated;
}

async function creatorsRoutes(fastify, opts) {
  /**
   * Crear un nuevo creator/dashboard
   */
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
          lives: MAX_LIVES,
          lastRefillAt: new Date(),
        },
      });

      // Generar token JWT
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

  /**
   * Login por publicId → devuelve token
   */
  fastify.post("/creators/login", async (req, reply) => {
    try {
      const { publicId } = req.body;

      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator) {
        return reply.code(404).send({ error: "Creator no encontrado" });
      }

      const token = fastify.generateToken(creator);
      reply.send({ token, creator });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error en login" });
    }
  });

  /**
   * Obtener mi perfil (requiere auth)
   */
  fastify.get(
    "/creators/me",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({
          where: { id: req.user.id },
        });
        if (!creator) return reply.code(404).send({ error: "No encontrado" });

        reply.send(creator);
      } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({ error: "Error obteniendo perfil" });
      }
    }
  );

  /**
   * Consultar vidas actuales del creator
   */
  fastify.get(
    "/dashboard/:creatorId/lives",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const { creatorId } = req.params;

        if (req.user.id !== creatorId) {
          return reply.code(403).send({ error: "No autorizado" });
        }

        let creator = await prisma.creator.findUnique({ where: { id: creatorId } });
        if (!creator) return reply.code(404).send({ error: "Creator no encontrado" });

        creator = await refillLives(creator);

        reply.send({
          lives: creator.lives,
          maxLives: MAX_LIVES,
          minutesToNext: minutesToNextLife(creator),
          isPremium: creator.isPremium,
        });
      } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({ error: "Error consultando vidas" });
      }
    }
  );
}

module.exports = creatorsRoutes;
