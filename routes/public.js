// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize"); // 👈 1. IMPORTAR

async function publicRoutes(fastify, opts) {
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      // 👇 2. SANITIZAR ENTRADAS
      const cleanContent = sanitize(req.body.content);
      const cleanAlias = sanitize(req.body.alias) || "Anónimo";

      if (!cleanContent || cleanContent.trim() === "") { // 👈 3. USAR VARIABLE LIMPIA
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
          anonAlias: cleanAlias, // 👈 4. USAR VARIABLE LIMPIA
        },
      });

      const message = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          alias: cleanAlias, // 👈 5. USAR VARIABLE LIMPIA
          content: cleanContent, // 👈 6. USAR VARIABLE LIMPIA
        },
      });

      // ==================
      //  👇 ¡AQUÍ ESTÁ LA MODIFICACIÓN! 👇
      // Cambiamos el 'type' a 'message' y enviamos el mensaje completo
      // para ser consistentes con la otra ruta.
      fastify.broadcastToDashboard(creator.id, {
        type: 'message',
        ...message, // El objeto 'message' ya contiene el chatId
      });
      // ==================

      // ... (resto de la función)
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
}

module.exports = publicRoutes;