// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const { checkAndResetLimit } = require('../utils/paymentHelpers');
const { sendPushToCreator } = require("../utils/expoPush");
const { checkContent } = require("../utils/contentFilter");

async function publicRoutes(fastify, opts) {

  // --- RUTA PRINCIPAL: Envío de mensaje gratuito ---
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const { content, alias, imageUrl, mediaType } = req.body;

      // 1. Validar contenido
      if ((!content || content.trim().length < 1) && !imageUrl) {
        return reply.code(400).send({ error: "El mensaje no puede estar vacío si no hay archivo adjunto." });
      }

      const cleanContent = sanitize(content);
      const cleanAlias = sanitize(alias) || "Anónimo";

      // 2. Moderación: rechaza amenazas / acoso grave.
      const mod = checkContent(cleanContent);
      if (!mod.ok) {
        return reply.code(422).send({ error: mod.reason });
      }

      // 3. Buscar creador
      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { id: true, name: true }
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }



      // 4. Moderación del mensaje (Eliminada)

      // 5. Crear o reutilizar el chat y guardar el mensaje
      const anonToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

      const chat = await prisma.chat.create({
        data: {
          id: crypto.randomUUID(),
          anonToken,
          anonAlias: cleanAlias,
          expiresAt: expiresAt,
          creator: { connect: { id: creator.id } },
          messages: {
            create: {
              id: crypto.randomUUID(),
              content: cleanContent,
              from: "anon",
              imageUrl: imageUrl || null,
              mediaType: mediaType || null
            }
          }
        }
      });
      // Obtener el mensaje recién creado para enviarlo
      const initialMessage = await prisma.chatMessage.findFirst({
        where: { chatId: chat.id, from: 'anon' },
        orderBy: { createdAt: 'asc' }
      });

      if (initialMessage) {
        fastify.broadcastToDashboard(creator.id, {
          type: "message",
          ...initialMessage
        });
      }

      // Push a la app nativa del creador: nuevo mensaje anónimo.
      sendPushToCreator(prisma, creator.id, {
        title: "Nuevo mensaje anónimo 👻",
        body: cleanContent,
        chatId: chat.id,
      }).catch(() => {});

      fastify.log.info(`Mensaje gratuito enviado al creador ${publicId} (chat: ${chat.id})`);
      reply.code(201).send({ success: true, chatId: chat.id, anonToken });

    } catch (err) {
      fastify.log.error(err, "Error en POST /public/:publicId/messages");
      reply.code(500).send({ error: "Error al enviar el mensaje." });
    }
  });


  // --- DATOS DE ESCASEZ (cupos del día) ---
  fastify.get("/public/:publicId/escasez", async (req, reply) => {
    return reply.send({ dailyMsgLimit: 1000, msgCountToday: 0, remainingSlots: 1000, resetTime: new Date(new Date().getTime() + 12 * 60 * 60 * 1000) });
  });

  // --- INFORMACIÓN PÚBLICA DEL CREADOR ---
  fastify.get("/public/creator/:publicId", async (req, reply) => {
    try {
      const { publicId } = req.params;
      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: {
          id: true, name: true, aliasPrompt: true, messagePrompt: true, avatarUrl: true
        }
      });
      if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });
      reply.send({
        creatorName: creator.name,
        aliasPrompt: creator.aliasPrompt || null,
        messagePrompt: creator.messagePrompt || null,
        avatarUrl: creator.avatarUrl || null,
        premiumContract: null,
        topicPreference: null,
        escasezData: { dailyMsgLimit: 1000, msgCountToday: 0 },
        isFull: false
      });
    } catch (err) {
      fastify.log.error(err, "❌ Error en GET /public/creator/:publicId:");
      return reply.code(500).send({ error: "Error obteniendo información del creador" });
    }
  });

  // --- NOTITAS PÚBLICAS (tendedero) : primer mensaje anónimo de cada chat ---
  // Solo texto + alias, sin foto ni datos del chat. Para mostrarlas como
  // "notas de Instagram" debajo del formulario del enlace público.
  fastify.get("/public/:publicId/notes", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { id: true },
      });
      if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });

      const chats = await prisma.chat.findMany({
        where: { creatorId: creator.id },
        include: {
          messages: {
            where: { from: "anon" },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 60,
      });

      const notes = chats
        .map((chat) => {
          const m = chat.messages[0];
          if (!m || !m.content || !m.content.trim()) return null;
          if (m.hidden) return null; // el creador la archivó: no se muestra
          return {
            id: m.id,
            content: m.content,
            alias: m.alias || chat.anonAlias || "Anónimo",
            createdAt: m.createdAt,
            order: m.collageOrder,
          };
        })
        .filter(Boolean)
        // Respeta el orden del collage (collageOrder); las que no tienen orden
        // van al final por fecha (más recientes primero).
        .sort((a, b) => {
          if (a.order != null && b.order != null) return a.order - b.order;
          if (a.order != null) return -1;
          if (b.order != null) return 1;
          return new Date(b.createdAt) - new Date(a.createdAt);
        })
        .slice(0, 40)
        .map(({ order, ...rest }) => rest);

      reply.send(notes);
    } catch (err) {
      fastify.log.error(err, "❌ Error en GET /public/:publicId/notes:");
      return reply.code(500).send({ error: "Error obteniendo las notitas" });
    }
  });

  // --- INFO BÁSICA (nombre, último activo) ---
  fastify.get("/public/:publicId/info", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { name: true, lastActive: true }
      });
      if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });
      reply.send({ name: creator.name, lastActiveAt: creator.lastActive });
    } catch (err) {
      fastify.log.error(err, "❌ Error en /public/:publicId/info:");
      return reply.code(500).send({ error: "Error obteniendo información del creador" });
    }
  });
}

module.exports = publicRoutes;