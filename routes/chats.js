// routes/chats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

async function chatsRoutes(fastify, opts) {
  /**
   * Crear un chat desde el lado anónimo
   */
  fastify.post("/chats", async (req, reply) => {
    try {
      const { publicId, content, alias } = req.body;

      if (!publicId || !content) {
        return reply
          .code(400)
          .send({ error: "Faltan campos obligatorios (publicId, content)" });
      }

      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator) return reply.code(404).send({ error: "Creator no encontrado" });

      const anonToken = crypto.randomUUID();
      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken,
        },
      });

      await prisma.chatMessage.create({
        data: { chatId: chat.id, from: "anon", content, alias },
      });

      const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const chatUrl = `${baseUrl}/chats/${anonToken}/${chat.id}`;

      reply.code(201).send({
        chatId: chat.id,
        anonToken,
        chatUrl,
        creatorName: creator.name,
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error creando chat" });
    }
  });

  /**
   * Obtener chat por anonToken
   */
  fastify.get("/chats/:anonToken", async (req, reply) => {
    try {
      const { anonToken } = req.params;
      const chat = await prisma.chat.findUnique({
        where: { anonToken },
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
          creator: true,
        },
      });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      reply.send(chat);
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });

  /**
   * Obtener todos los mensajes de un chat por anonToken + chatId
   */
  fastify.get("/chats/:anonToken/:chatId", async (req, reply) => {
    try {
      const { anonToken, chatId } = req.params;
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, anonToken },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          creator: true,
        },
      });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      reply.send({
        messages: chat.messages,
        creatorName: chat.creator?.name || null,
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error obteniendo mensajes del chat" });
    }
  });

  /**
   * Enviar mensaje desde el anónimo
   */
  fastify.post("/chats/:anonToken/:chatId/messages", async (req, reply) => {
    try {
      const { anonToken, chatId } = req.params;
      const { content, alias } = req.body;

      if (!content) return reply.code(400).send({ error: "Falta content" });

      const chat = await prisma.chat.findFirst({
        where: { id: chatId, anonToken },
      });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      const msg = await prisma.chatMessage.create({
        data: { chatId: chat.id, from: "anon", content, alias },
      });

      reply.code(201).send(msg);
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });
}

module.exports = chatsRoutes;
