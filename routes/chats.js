// routes/chats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize"); // 👈 1. IMPORTAR (Esto ya lo tenías)

async function chatsRoutes(fastify, opts) {

  /**
   * Enviar mensaje desde el anónimo
   */
  fastify.post("/chats/:anonToken/:chatId/messages", async (req, reply) => {
    try {
      const { anonToken, chatId } = req.params;
      
      // 👇 SANITIZAR ENTRADAS
      const cleanContent = sanitize(req.body.content);

      // 👇 CORRECCIÓN 1: Validar la variable LIMPIA
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
          content: cleanContent, // 👈 CORRECCIÓN 2: Usar la variable LIMPIA
          alias: chat.anonAlias || "Anónimo",
        },
      });

      // ¡LA MAGIA OCURRE AQUÍ!
      // Después de guardar, enviamos el mensaje por WebSocket a la sala correcta.
      const payload = {
        type: "message",
        ...msg, // Enviamos el objeto completo del mensaje recién creado
      };
      fastify.broadcastToChat(chat.id, payload);
      
      reply.code(201).send(msg);
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });
  
  /**
   * Crear un chat desde el lado anónimo 
   * (Esta ruta también necesitaba sanitización)
   */
  fastify.post("/chats", async (req, reply) => {
    try {
      const { publicId } = req.body;
      
      // 👇 CORRECCIÓN 3: Sanitizar AMBAS entradas
      const cleanContent = sanitize(req.body.content);
      const cleanAlias = sanitize(req.body.alias) || "Anónimo";

      // 👇 CORRECCIÓN 4: Validar la variable LIMPIA
      if (!publicId || !cleanContent || cleanContent.trim() === "") {
        return reply
          .code(400)
          .send({ error: "Faltan campos obligatorios (publicId, content)" });
      }

      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator)
        return reply.code(404).send({ error: "Creator no encontrado" });

      const anonToken = crypto.randomUUID();

      // Crear el chat
      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken,
          anonAlias: cleanAlias, // 👈 CORRECCIÓN 5: Guardar alias limpio
        },
      });

      // Insertar primer mensaje
      await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          content: cleanContent, // 👈 CORRECCIÓN 6: Usar content limpio
          alias: cleanAlias,     // 👈 CORRECCIÓN 7: Usar alias limpio
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
        anonAlias: chat.anonAlias || last?.alias || "Anónimo", // Usar el alias del chat
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
          alias: m.alias || chat.anonAlias || "Anónimo", // Usar el alias del chat
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