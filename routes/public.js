// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

async function publicRoutes(fastify, opts) {
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const { alias, content } = req.body;

      if (!content || content.trim() === "") {
        return reply.code(400).send({ error: "El mensaje no puede estar vacío" });
      }

      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      // --- CORRECCIÓN CLAVE ---
      // 1. Se genera un token único SIEMPRE para cada nuevo chat.
      const anonToken = crypto.randomUUID();

      // 2. Se elimina la búsqueda de un chat existente y se crea uno nuevo directamente.
      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken,
          anonAlias: alias?.trim() || "Anónimo",
        },
      });

      // Se crea el mensaje para el chat recién creado.
      const message = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          alias: alias?.trim() || "Anónimo",
          content,
        },
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
}

module.exports = publicRoutes;