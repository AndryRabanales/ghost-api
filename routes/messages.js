// routes/messages.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

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
   * Abrir un mensaje anónimo
   * (Simplificado: Ya no consume vidas, solo marca como visto)
   */
  fastify.post(
    "/dashboard/:creatorId/open-message/:messageId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const { creatorId, messageId } = req.params;
        
        // Verificación de autorización
        if (req.user.id !== creatorId) {
          return reply.code(403).send({ error: "No autorizado" });
        }

        // Buscar el mensaje
        const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
        if (!message) return reply.code(404).send({ error: "Mensaje no encontrado" });

        // Si es un mensaje anónimo y aún no se ha visto, marcarlo como visto
        if (message.from === "anon" && !message.seen) {
          const updatedMsg = await prisma.chatMessage.update({
            where: { id: messageId },
            data: { seen: true },
          });
          return reply.send(updatedMsg);
        }

        // Si ya estaba visto o es del propio creador, devolverlo tal cual
        return reply.send(message);

      } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({ error: "Error abriendo mensaje" });
      }
    }
  );
}

module.exports = messagesRoutes;