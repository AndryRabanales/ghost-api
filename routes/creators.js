// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

// Configuración de regeneración de vidas
const LIFE_INTERVAL = 30 * 60 * 1000; // 15 minutos

/**
 * Calcula cuántos minutos faltan para la siguiente vida.
 */
function minutesToNextLife(creator) {
  if (creator.lives >= creator.maxLives) return 0;
  if (!creator.lastUpdated) return 0;

  const now = Date.now();
  const last = new Date(creator.lastUpdated).getTime();
  const elapsed = now - last;

  const remaining = LIFE_INTERVAL - (elapsed % LIFE_INTERVAL);
  return Math.ceil(remaining / 60000);
}

/**
 * Revisa si corresponde recargar vidas automáticamente.
 */
async function refillLives(creator) {
  if (creator.lives >= creator.maxLives) return creator;

  const now = Date.now();
  const last = creator.lastUpdated ? new Date(creator.lastUpdated).getTime() : 0;
  const elapsed = now - last;

  if (elapsed < LIFE_INTERVAL) return creator;

  const regenerated = Math.floor(elapsed / LIFE_INTERVAL);
  let newLives = creator.lives + regenerated;
  if (newLives > creator.maxLives) newLives = creator.maxLives;

  const updated = await prisma.creator.update({
    where: { id: creator.id },
    data: {
      lives: newLives,
      lastUpdated: new Date(now - (elapsed % LIFE_INTERVAL)),
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
          lives: 6,
          maxLives: 6,
          lastUpdated: new Date(),
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
          data: {
            isPremium: false,
            subscriptionStatus: 'expired'
          }
        });
        fastify.log.info(`La suscripción Premium para ${creator.id} ha expirado.`);
      }
      // --- FIN DE LA LÓGICA DE EXPIRACIÓN ---
  
      const updated = await refillLives(creator);
  
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
   * Consultar vidas actuales del creator
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
              orderBy: { createdAt: "desc" },
              take: 1, // Solo necesitamos el último mensaje para la preview
            },
          },
        });

        // Asegúrate de incluir 'isOpened' y usar 'c.anonAlias'
        const formatted = chats.map((c) => { // 'c' es el objeto Chat completo de Prisma
          const lastMsg = c.messages[0] || null;
          // *** VERIFICACIÓN CRÍTICA AQUÍ ***
          console.log(`Chat ID: ${c.id}, DB Alias: ${c.anonAlias}`); // <-- Log para depuración
          return {
            id: c.id,
            // anonToken: c.anonToken, // Descomenta si lo necesitas en el frontend
            createdAt: c.createdAt,
            isOpened: c.isOpened, // Importante para la UI
            lastMessage: lastMsg
              ? {
                  id: lastMsg.id,
                  from: lastMsg.from,
                  // Cortar preview si es muy largo
                  content: lastMsg.content.slice(0, 80) + (lastMsg.content.length > 80 ? '...' : ''),
                  alias: lastMsg.alias, // Puedes mantener el alias del último mensaje por contexto si quieres
                  seen: lastMsg.seen,
                  createdAt: lastMsg.createdAt,
                }
              : null,
            // --- 👇 ASEGÚRATE DE QUE ESTA LÍNEA ESTÉ ASÍ 👇 ---
            anonAlias: c.anonAlias || "Anónimo", // Usa el alias guardado en el Chat 'c'
            // --- 👆 FIN DE LA LÍNEA CRÍTICA 👆 ---
          };
        });
         console.log('Formatted Chats:', formatted.map(f => ({ id: f.id, alias: f.anonAlias }))); // <-- Log de lo que se envía

        reply.send(formatted);
      } catch (err) {
        fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats:", err);
        reply.code(500).send({ error: "Error obteniendo chats del dashboard" });
      }
    }
  );

  /**
   * Refrescar token con publicId
   */
  fastify.post("/refresh-token", async (req, reply) => {
    try {
      const { publicId } = req.body;

      if (!publicId) {
        return reply.code(400).send({ error: "publicId requerido" });
      }

      const creator = await prisma.creator.findUnique({
        where: { publicId },
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      const newToken = fastify.generateToken(creator);

      return reply.send({ token: newToken });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error renovando token" });
    }
  });
}

module.exports = creatorsRoutes;