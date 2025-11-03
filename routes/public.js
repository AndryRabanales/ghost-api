// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize"); // 👈 1. IMPORTAR

async function publicRoutes(fastify, opts) {
  
  // --- Ruta existente para ENVIAR mensajes ---
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const cleanContent = sanitize(req.body.content);
      const cleanAlias = sanitize(req.body.alias) || "Anónimo";

      if (!cleanContent || cleanContent.trim() === "") {
        return reply.code(400).send({ error: "El mensaje no puede estar vacío" });
      }

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
          content: cleanContent,
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

  // --- 👇 RUTA NUEVA (AHORA DENTRO DE LA FUNCIÓN) 👇 ---
  /**
   * NUEVO: Obtener información pública del creador
   */
  fastify.get("/public/:publicId/info", async (req, reply) => {
    try {
      const { publicId } = req.params;

      const creator = await prisma.creator.findUnique({
        where: { publicId },
        select: {
          name: true,
          updatedAt: true, // Usamos 'updatedAt' como indicador de "última vez activo"
        },
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      // Devolvemos solo los datos públicos
      return reply.send({
        name: creator.name || "Anónimo",
        lastActiveAt: creator.updatedAt,
      });

    } catch (err) {
      fastify.log.error("❌ Error en /public/:publicId/info:", err);
      return reply.code(500).send({ error: "Error obteniendo información" });
    }
  });
  // --- 👆 FIN DEL BLOQUE NUEVO 👆 ---

} // <-- Esta es la llave de cierre de publicRoutes

module.exports = publicRoutes;