// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

// ... (funciones minutesToNextLife y refillLives sin cambios) ...
function minutesToNextLife(creator) {
  if (creator.lives >= creator.maxLives) return 0;
  if (!creator.lastUpdated) return 0;
  const now = Date.now();
  const last = new Date(creator.lastUpdated).getTime();
  const elapsed = now - last;
  const remaining = 30 * 60 * 1000 - (elapsed % (30 * 60 * 1000));
  return Math.ceil(remaining / 60000);
}
async function refillLives(creator) {
  if (creator.lives >= creator.maxLives) return creator;
  const now = Date.now();
  const last = creator.lastUpdated ? new Date(creator.lastUpdated).getTime() : 0;
  const elapsed = now - last;
  if (elapsed < 30 * 60 * 1000) return creator;
  const regenerated = Math.floor(elapsed / (30 * 60 * 1000));
  let newLives = creator.lives + regenerated;
  if (newLives > creator.maxLives) newLives = creator.maxLives;
  const updated = await prisma.creator.update({
    where: { id: creator.id },
    data: {
      lives: newLives,
      lastUpdated: new Date(now - (elapsed % (30 * 60 * 1000))),
    },
  });
  return updated;
}


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

  /**
   * Obtener datos del usuario autenticado (con chequeo de expiración de premium)
   */
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

      // --- LÓGICA DE EXPIRACIÓN DE PREMIUM ---
      if (creator.isPremium && creator.premiumExpiresAt && new Date() > new Date(creator.premiumExpiresAt)) {
        creator = await prisma.creator.update({
          where: { id: creator.id },
          data: { isPremium: false, subscriptionStatus: 'expired' }
        });
        fastify.log.info(`La suscripción Premium para ${creator.id} ha expirado.`);
      }
  
      const updated = await refillLives(creator);

      // --- 👇 LÍNEA ELIMINADA 👇 ---
      // Se ha eliminado el broadcast 'CREATOR_ACTIVE'. El WS de conexión/desconexión maneja esto.
      // fastify.broadcastToPublic(updated.publicId, { ... });

      reply.send({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        publicId: updated.publicId,
        lives: updated.lives,
        maxLives: updated.maxLives,
        minutesToNextLife: minutesToNextLife(updated),
        isPremium: updated.isPremium,
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /creators/me:", err);
      reply.code(500).send({ error: "Error obteniendo perfil del creator" });
    }
  });
  
  /**
   * Consultar chats del dashboard
   */
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
              // --- 👇 CAMBIO: Obtener el ÚLTIMO mensaje para la preview ---
              orderBy: { createdAt: "desc" }, 
              take: 1,
            },
          },
        });

        const formatted = chats.