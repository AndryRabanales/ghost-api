// andryrabanales/ghost-api/ghost-api-8daef8647d2051e5509f263068ad498cc3350564/routes/chats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");

async function chatsRoutes(fastify, opts) {

  // ... (ruta POST /chats/:anonToken/:chatId/messages sin cambios) ...
  fastify.post("/chats/:anonToken/:chatId/messages", async (req, reply) => {
    try {
      const { anonToken, chatId } = req.params;
      const cleanContent = sanitize(req.body.content);
      if (!cleanContent || cleanContent.trim() === "") {
        return reply.code(400).send({ error: "Falta el contenido del mensaje" });
      }
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, anonToken },
      });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });
      const msg = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          content: cleanContent, 
          alias: chat.anonAlias || "Anónimo",
        },
      });
      await prisma.chat.update({
          where: { id: chatId },
          data: { anonReplied: true },
      });
      const payload = { type: "message", ...msg };
      fastify.broadcastToChat(chat.id, payload);
      fastify.broadcastToDashboard(chat.creatorId, payload);
      reply.code(201).send(msg);
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });
  
  // ... (ruta POST /chats sin cambios) ...
  fastify.post("/chats", async (req, reply) => {
    try {
      const { publicId } = req.body;
      const cleanContent = sanitize(req.body.content);
      const cleanAlias = sanitize(req.body.alias) || "Anónimo";
      if (!publicId || !cleanContent || cleanContent.trim() === "") {
        return reply
          .code(400)
          .send({ error: "Faltan campos obligatorios (publicId, content)" });
      }
      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator)
        return reply.code(404).send({ error: "Creator no encontrado" });
      const anonToken = crypto.randomUUID();
      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken,
          anonAlias: cleanAlias,
        },
      });
      await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          content: cleanContent,
          alias: cleanAlias,
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

  // ... (ruta GET /chats/:anonToken sin cambios) ...
  fastify.get("/chats/:anonToken", async (req, reply) => {
    try {
      const { anonToken } = req.params;
      const chat = await prisma.chat.findFirst({
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
        lastMessage: last ? {
              id: last.id,
              from: last.from,
              content: last.content,
              alias: last.alias || "Anónimo",
              seen: last.seen,
              createdAt: last.createdAt,
            } : null,
        anonAlias: chat.anonAlias || last?.alias || "Anónimo",
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
          creator: true, // <-- El 'creator' ya estaba incluido
        },
      });

      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      reply.send({
        messages: chat.messages.map((m) => ({
          id: m.id,
          from: m.from,
          content: m.content,
          alias: m.alias || chat.anonAlias || "Anónimo",
          seen: m.seen,
          createdAt: m.createdAt,
        })),
        creatorName: chat.creator?.name || null,
        // --- 👇 AÑADIDO: Devolver la última actividad del creador ---
        creatorLastActive: chat.creator?.updatedAt || null
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error obteniendo mensajes del chat" });
    }
  });
}

module.exports = chatsRoutes;