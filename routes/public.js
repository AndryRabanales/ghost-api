// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const { checkAndResetLimit } = require('../utils/paymentHelpers');

async function publicRoutes(fastify, opts) {

  // --- RUTA PRINCIPAL: Envío de mensaje gratuito ---
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const { content, alias } = req.body;

      // 1. Validar contenido
      if (!content || content.trim().length < 3) {
        return reply.code(400).send({ error: "El mensaje es muy corto." });
      }

      const cleanContent = sanitize(content);
      const cleanAlias = sanitize(alias) || "Anónimo";

      // 2. Moderación de alias (Eliminada)

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
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

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
          id: true, name: true
        }
      });
      if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });
      reply.send({
        creatorName: creator.name,
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