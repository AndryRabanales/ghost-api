// andryrabanales/ghost-api/ghost-api-8daef8647d2051e5509f263068ad498cc3350564/routes/chats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const { publicKey: vapidPublicKey } = require("../utils/push");
const { sendPushToCreator } = require("../utils/expoPush");
const { checkContent } = require("../utils/contentFilter");

async function chatsRoutes(fastify, opts) {
  /**
   * Llave pública VAPID (para que el navegador se suscriba a push)
   */
  fastify.get("/push/vapid-public-key", async (req, reply) => {
    if (!vapidPublicKey) return reply.code(503).send({ error: "Push no configurado" });
    reply.send({ publicKey: vapidPublicKey });
  });

  /**
   * Guardar una suscripción push para un chat anónimo
   */
  fastify.post("/:anonToken/:chatId/push-subscribe", async (req, reply) => {
    try {
      const { anonToken, chatId } = req.params;
      const { subscription } = req.body;

      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return reply.code(400).send({ error: "Suscripción inválida" });
      }

      const chat = await prisma.chat.findUnique({ where: { id: chatId, anonToken } });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      await prisma.pushSubscription.upsert({
        where: { endpoint: subscription.endpoint },
        update: { chatId: chat.id, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        create: {
          chatId: chat.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      });

      reply.code(201).send({ success: true });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error guardando la suscripción" });
    }
  });

  // ... (ruta POST /chats/:anonToken/:chatId/messages sin cambios) ...
  fastify.post("/:anonToken/:chatId/messages", async (req, reply) => {
    try {
      const { anonToken, chatId } = req.params;

      const cleanContent = sanitize(req.body.content);
      const cleanAlias = sanitize(req.body.alias) || "Anónimo";

      if ((!cleanContent || cleanContent.trim().length < 1) && !req.body.imageUrl) {
        return reply.code(400).send({ error: "El mensaje no puede estar vacío si no hay archivo adjunto." });
      }

      const chat = await prisma.chat.findUnique({
        where: { id: chatId, anonToken: anonToken }
      });

      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado o no autorizado." });
      }

      // El creador bloqueó a este anónimo: no acepta más mensajes.
      if (chat.blocked) {
        return reply.code(403).send({ error: "Este chat ya no acepta mensajes." });
      }

      // Moderación: rechaza amenazas / acoso grave.
      const mod = checkContent(cleanContent);
      if (!mod.ok) {
        return reply.code(422).send({ error: mod.reason });
      }

      // Actualiza anonReplied a true
      await prisma.chat.update({
        where: { id: chatId },
        data: { anonReplied: true }
      });

      const msg = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          content: cleanContent,
          alias: cleanAlias,
          imageUrl: req.body.imageUrl || null,
          mediaType: req.body.mediaType || null
        }
      });

      const payload = {
        type: "message",
        ...msg,
      };

      // Emitimos el mensaje mediante WebSocket al creador y al propio chat
      fastify.broadcastToDashboard(chat.creatorId, payload);
      fastify.broadcastToChat(chat.id, payload);

      // Push a la app nativa del creador (si tiene la app instalada).
      sendPushToCreator(prisma, chat.creatorId, {
        title: `${cleanAlias} te respondió 👻`,
        body: cleanContent,
        chatId: chat.id,
      }).catch(() => {});

      reply.code(201).send(msg);

    } catch (err) {
      fastify.log.error("❌ Error en POST /:anonToken/:chatId/messages:", err);
      return reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });

  // ... (ruta POST /chats sin cambios) ...
  fastify.post("/chats", async (req, reply) => {
    try {
      const { publicId } = req.body;
      const cleanContent = sanitize(req.body.content);
      const cleanAlias = sanitize(req.body.alias) || "Anónimo";
      if (!publicId || ((!cleanContent || cleanContent.trim() === "") && !req.body.imageUrl)) {
        return reply
          .code(400)
          .send({ error: "Faltan campos obligatorios o el mensaje está vacío." });
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
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        },
      });
      await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          content: cleanContent,
          alias: cleanAlias,
          imageUrl: req.body.imageUrl || null,
          mediaType: req.body.mediaType || null
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
          imageUrl: last.imageUrl || null,
          mediaType: last.mediaType || null
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
          imageUrl: m.imageUrl || null,
          mediaType: m.mediaType || null
        })),
        creatorName: chat.creator?.name || null,
        creatorPublicId: chat.creator?.publicId || null,
        creatorAvatarUrl: chat.creator?.avatarUrl || null,
        creatorLastActive: chat.creator?.updatedAt || null,
        expiresAt: chat.expiresAt || null
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error obteniendo mensajes del chat" });
    }
  });

  /**
   * Eliminar (Abandonar) un chat de inmediato
   */
  fastify.delete("/chats/:anonToken/:chatId", async (req, reply) => {
    try {
      const { anonToken, chatId } = req.params;

      const chat = await prisma.chat.findUnique({
        where: { id: chatId, anonToken }
      });

      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado o no autorizado" });
      }

      await prisma.chat.delete({
        where: { id: chatId }
      });

      fastify.broadcastToDashboard(chat.creatorId, {
        type: 'CHAT_ABANDONED',
        chatId: chatId
      });

      reply.code(200).send({ success: true, message: "Chat eliminado y abandonado con éxito." });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error al eliminar el chat." });
    }
  });
}

module.exports = chatsRoutes;