// routes/messages.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Configuración de vidas
const LIFE_INTERVAL = 15 * 60 * 1000; // 15 minutos

// Helpers internos
function minutesToNextLife(creator) {
  if (creator.lives >= creator.maxLives) return 0;
  const now = Date.now();
  const lastUpdated = new Date(creator.lastUpdated).getTime();
  const elapsed = now - lastUpdated;
  const remaining = LIFE_INTERVAL - (elapsed % LIFE_INTERVAL);
  return Math.ceil(remaining / 60000);
}

async function refillLives(creator) {
  const now = Date.now();
  const lastUpdated = new Date(creator.lastUpdated).getTime();
  const elapsed = now - lastUpdated;

  if (creator.lives < creator.maxLives) {
    const regenerated = Math.floor(elapsed / LIFE_INTERVAL);
    if (regenerated > 0) {
      let newLives = creator.lives + regenerated;
      if (newLives > creator.maxLives) newLives = creator.maxLives;

      const newLastUpdated = new Date(now - (elapsed % LIFE_INTERVAL));

      creator = await prisma.creator.update({
        where: { id: creator.id },
        data: {
          lives: newLives,
          lastUpdated: newLastUpdated,
        },
      });
    }
  }
  return creator;
}

async function consumeLife(creator) {
  if (creator.lives <= 0) throw new Error("Sin vidas disponibles");

  return prisma.creator.update({
    where: { id: creator.id },
    data: {
      lives: creator.lives - 1,
      lastUpdated: new Date(),
    },
  });
}

// ==================
// RUTAS DE MENSAJES
// ==================
async function messagesRoutes(fastify, opts) {
  /**
   * Obtener todos los mensajes de un chat
   */
  fastify.get(
    "/dashboard/chats/:chatId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const { chatId } = req.params;

        const chat = await prisma.chat.findUnique({
          where: { id: chatId },
          include: {
            messages: { orderBy: { createdAt: "asc" } },
            creator: true,
          },
        });

        if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });
        if (req.user.id !== chat.creatorId) {
          return reply.code(403).send({ error: "No autorizado" });
        }

        reply.send({
          chatId: chat.id,
          messages: chat.messages,
          creatorName: chat.creator?.name || null,
        });
      } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({ error: "Error obteniendo chat del dashboard" });
      }
    }
  );

  /**
   * Responder en un chat (mensaje del creador)
   */
  fastify.post(
    "/dashboard/chats/:chatId/messages",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const { chatId } = req.params;
        const { content } = req.body;

        if (!content) return reply.code(400).send({ error: "Falta content" });

        const chat = await prisma.chat.findUnique({ where: { id: chatId } });
        if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });
        if (req.user.id !== chat.creatorId) {
          return reply.code(403).send({ error: "No autorizado" });
        }

        const msg = await prisma.chatMessage.create({
          data: { chatId, from: "creator", content },
        });

        reply.code(201).send(msg);
      } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({ error: "Error respondiendo en chat" });
      }
    }
  );

  /**
   * Abrir un mensaje anónimo → consume vida
   */
  fastify.post(
    "/dashboard/:creatorId/open-message/:messageId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const { creatorId, messageId } = req.params;
        if (req.user.id !== creatorId) {
          return reply.code(403).send({ error: "No autorizado" });
        }

        let creator = await prisma.creator.findUnique({ where: { id: creatorId } });
        if (!creator) return reply.code(404).send({ error: "Creator no encontrado" });

        // Refrescar vidas
        creator = await refillLives(creator);

        // Buscar mensaje
        const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
        if (!message) return reply.code(404).send({ error: "Mensaje no encontrado" });

        // Premium → no descuenta vidas
        if (creator.isPremium) {
          if (message.from === "anon" && !message.seen) {
            await prisma.chatMessage.update({
              where: { id: messageId },
              data: { seen: true },
            });
          }
          return reply.send({ ...message, lives: "∞" });
        }

        // Si ya fue visto o no es anónimo
        if (message.from !== "anon" || message.seen) {
          return reply.send({ ...message, lives: creator.lives });
        }

        // Consumir vida
        try {
          creator = await consumeLife(creator);
        } catch (err) {
          return reply.code(403).send({
            error: err.message,
            minutesToNext: minutesToNextLife(creator),
          });
        }

        // Marcar mensaje como visto
        await prisma.chatMessage.update({
          where: { id: messageId },
          data: { seen: true },
        });

        const freshMsg = await prisma.chatMessage.findUnique({ where: { id: messageId } });

        reply.send({
          ...freshMsg,
          lives: creator.lives,
          minutesToNext: minutesToNextLife(creator),
        });
      } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({ error: "Error abriendo mensaje" });
      }
    }
  );
}

module.exports = messagesRoutes;
