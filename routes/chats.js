// routes/chats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

async function chatsRoutes(fastify, opts) {
  // ... (el resto de tus rutas como GET /chats/:anonToken, etc. se quedan igual) ...

  /**
   * Enviar mensaje desde el anónimo
   */
  fastify.post("/chats/:anonToken/:chatId/messages", async (req, reply) => {
    try {
      const { anonToken, chatId } = req.params;
      const { content, alias } = req.body;

      if (!content)
        return reply.code(400).send({ error: "Falta el contenido del mensaje" });

      const chat = await prisma.chat.findFirst({
        where: { id: chatId, anonToken },
      });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });
      
      const msg = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          content,
          alias: chat.anonAlias || "Anónimo",
        },
      });

      // ¡LA MAGIA OCURRE AQUÍ!
      // Después de guardar, enviamos el mensaje por WebSocket a la sala correcta.
      const payload = {
        type: "message",
        ...msg, // Enviamos el objeto completo del mensaje recién creado
      };
      fastify.broadcast(chat.id, payload);
      
      reply.code(201).send(msg);
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });

  // ... (Aquí van las otras rutas que ya tenías en este archivo, como la de crear chat)
  
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
      if (!creator)
        return reply.code(404).send({ error: "Creator no encontrado" });

      // 🔑 Cada anónimo tendrá un token único
      const anonToken = crypto.randomUUID();

      // Crear el chat
      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken,
        },
      });

      // Insertar primer mensaje
      await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          content,
          alias: alias || null,
        },
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

      const chat = await prisma.chat.findFirst({ // Cambiado de findUnique a findFirst
        where: { anonToken },
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
          creator: true,
        },
      });

      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      const last = chat.messages?.[0] || null;

      reply.send({
        id: chat.id,
        anonToken: chat.anonToken,
        creatorName: chat.creator?.name || null,
        lastMessage: last
          ? {
              id: last.id,
              from: last.from,
              content: last.content,
              alias: last.alias || "Anónimo",
              seen: last.seen,
              createdAt: last.createdAt,
            }
          : null,
        anonAlias: last?.alias || "Anónimo",
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });

    /**
   * Obtener todos los mensajes de un chat
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
        messages: chat.messages.map((m) => ({
          id: m.id,
          from: m.from,
          content: m.content,
          alias: m.alias || "Anónimo",
          seen: m.seen,
          createdAt: m.createdAt,
        })),
        creatorName: chat.creator?.name || null,
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error obteniendo mensajes del chat" });
    }
  });
}

module.exports = chatsRoutes;