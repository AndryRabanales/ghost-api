// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const { analyzeMessage } = require('../utils/aiAnalyzer');
const { checkAndResetLimit } = require('../utils/paymentHelpers');

async function publicRoutes(fastify, opts) {

  // --- RUTA PRINCIPAL: Envío de mensaje gratuito ---
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const { content, alias, fanEmail } = req.body;

      // 1. Validar contenido
      if (!content || content.trim().length < 3) {
        return reply.code(400).send({ error: "El mensaje es muy corto." });
      }

      const cleanContent = sanitize(content);
      const cleanAlias = sanitize(alias) || "Anónimo";
      const cleanEmail = sanitize(fanEmail) || null;

      // 2. Moderación de alias con IA (no bloquea si falla)
      try {
        const aliasAnalysis = await analyzeMessage(cleanAlias, null, true);
        if (!aliasAnalysis.isSafe) {
          return reply.code(400).send({ error: "Alias bloqueado por moderación." });
        }
      } catch (aiError) {
        fastify.log.warn(aiError, "AI check (alias) falló, permitiendo...");
      }

      // 3. Buscar creador y verificar límite diario
      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { id: true, name: true, dailyMsgLimit: true, msgCountToday: true, msgCountLastReset: true, topicPreference: true }
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      creator = await checkAndResetLimit(creator, fastify);

      if (creator.dailyMsgLimit > 0 && creator.msgCountToday >= creator.dailyMsgLimit) {
        return reply.code(429).send({
          error: "Este creador ha alcanzado su límite diario de mensajes. Intenta de nuevo mañana.",
          code: "DAILY_LIMIT_REACHED"
        });
      }

      // 4. Moderación del mensaje con IA
      try {
        const msgAnalysis = await analyzeMessage(cleanContent, creator.topicPreference);
        if (!msgAnalysis.isSafe) {
          return reply.code(400).send({ error: `Mensaje bloqueado: ${msgAnalysis.reason || 'contenido inapropiado'}` });
        }
      } catch (aiError) {
        fastify.log.warn(aiError, "AI check (message) falló, permitiendo...");
      }

      // 5. Crear o reutilizar el chat y guardar el mensaje
      const anonToken = crypto.randomUUID();

      const chat = await prisma.chat.create({
        data: {
          id: crypto.randomUUID(),
          anonToken,
          anonAlias: cleanAlias,
          anonEmail: cleanEmail,
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

      // 6. Incrementar contador del día
      await prisma.creator.update({
        where: { id: creator.id },
        data: { msgCountToday: { increment: 1 } }
      });

      fastify.log.info(`Mensaje gratuito enviado al creador ${publicId} (chat: ${chat.id})`);
      reply.code(201).send({ success: true, chatId: chat.id, anonToken });

    } catch (err) {
      fastify.log.error(err, "Error en POST /public/:publicId/messages");
      reply.code(500).send({ error: "Error al enviar el mensaje." });
    }
  });


  // --- DATOS DE ESCASEZ (cupos del día) ---
  fastify.get("/public/:publicId/escasez", async (req, reply) => {
    try {
      const { publicId } = req.params;
      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { id: true, dailyMsgLimit: true, msgCountToday: true, msgCountLastReset: true }
      });
      if (!creator) {
        return reply.send({ dailyMsgLimit: 1000, msgCountToday: 0, remainingSlots: 1000, resetTime: new Date(new Date().getTime() + 12 * 60 * 60 * 1000) });
      }
      creator = await checkAndResetLimit(creator, fastify);
      const remaining = Math.max(0, creator.dailyMsgLimit - creator.msgCountToday);
      const resetTime = new Date(new Date(creator.msgCountLastReset).getTime() + 12 * 60 * 60 * 1000);
      reply.send({ dailyMsgLimit: creator.dailyMsgLimit, msgCountToday: creator.msgCountToday, remainingSlots: remaining, resetTime });
    } catch (err) {
      fastify.log.error(err, "❌ Error en /public/:publicId/escasez:");
      return reply.code(500).send({ error: "Error obteniendo datos de escasez" });
    }
  });

  // --- INFORMACIÓN PÚBLICA DEL CREADOR ---
  fastify.get("/public/creator/:publicId", async (req, reply) => {
    try {
      const { publicId } = req.params;
      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: {
          id: true, name: true, premiumContract: true, dailyMsgLimit: true,
          msgCountToday: true, msgCountLastReset: true, topicPreference: true
        }
      });
      if (!creator) return reply.code(404).send({ error: "Creador no encontrado" });
      creator = await checkAndResetLimit(creator, fastify);
      const isFull = (creator.dailyMsgLimit > 0) && (creator.msgCountToday >= creator.dailyMsgLimit);
      const topic = creator.topicPreference || "Cualquier mensaje respetuoso.";
      reply.send({
        creatorName: creator.name,
        premiumContract: creator.premiumContract,
        topicPreference: topic,
        escasezData: { dailyMsgLimit: creator.dailyMsgLimit, msgCountToday: creator.msgCountToday },
        isFull
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