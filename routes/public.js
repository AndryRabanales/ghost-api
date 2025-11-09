// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize"); //
const { analyzeMessage } = require('../utils/aiAnalyzer'); //

async function publicRoutes(fastify, opts) {

  // --- Ruta existente para ENVIAR mensajes ---
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      
      // ¡IMPORTANTE! Obtenemos el contenido ORIGINAL primero
      const originalContent = req.body.content;
      const originalAlias = req.body.alias || "Anónimo";

      // --- BLOQUE DE MODERACIÓN DE IA (MOVIDO ARRIBA Y CORREGIDO) ---
      if (!originalContent || originalContent.trim().length < 3) {
        // ¡CORREGIDO! Usando 'reply.code().send()'
        return reply.code(400).send({ error: "El mensaje es muy corto." });
      }

      try {
        // ¡CORREGIDO! Analizamos el 'originalContent'
        const analysis = await analyzeMessage(originalContent);
        if (!analysis.isSafe) {
          // Si no es seguro, bloquea el mensaje
          // ¡CORREGIDO! Usando 'reply.code().send()'
          return reply.code(400).send({ error: analysis.reason || 'Mensaje bloqueado por moderación.' });
        }
      } catch (aiError) {
        console.error("Error llamando a la IA (public):", aiError);
        // Si la IA falla, lo dejamos pasar por ahora para no afectar al usuario.
      }
      // --- FIN DEL BLOQUE ---

      // Ahora que el mensaje es SEGURO, lo sanitizamos para guardarlo
      const cleanContent = sanitize(originalContent);
      const cleanAlias = sanitize(originalAlias);

      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      const anonToken = crypto.randomUUID();

      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken,
          anonAlias: cleanAlias,
        },
      });

      const message = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          alias: cleanAlias,
          content: cleanContent, // Guardamos el contenido ya limpio
        },
      });

      fastify.broadcastToDashboard(creator.id, {
        type: 'message',
        ...message,
      });

      const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const chatUrl = `${baseUrl}/chats/${anonToken}/${chat.id}`;

      return reply.code(201).send({
        success: true,
        chatId: chat.id,
        anonToken,
        chatUrl,
        creatorName: creator.name,
        message: {
          id: message.id,
          content: message.content,
          alias: message.alias,
          createdAt: message.createdAt,
        },
      });
    } catch (err) {
      fastify.log.error("❌ Error en /public/:publicId/messages:", err);
      return reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });

  // --- Ruta de Info (esta ya estaba bien) ---
  fastify.get("/public/:publicId/info", async (req, reply) => {
    try {
      const { publicId } = req.params;

      const creator = await prisma.creator.findUnique({
        where: { publicId },
        select: {
          name: true,
          updatedAt: true,
        },
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      return reply.send({
        name: creator.name || "Anónimo",
        lastActiveAt: creator.updatedAt,
      });

    } catch (err) {
      fastify.log.error("❌ Error en /public/:publicId/info:", err);
      return reply.code(500).send({ error: "Error obteniendo información" });
    }
  });

} // <-- Esta es la llave de cierre de publicRoutes

module.exports = publicRoutes;