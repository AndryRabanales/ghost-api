// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

async function publicRoutes(fastify, opts) {
  /**
   * Enviar un mensaje anónimo a un creador usando publicId
   */
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const { alias, content } = req.body;

      if (!content || content.trim() === "") {
        return reply.code(400).send({ error: "El mensaje no puede estar vacío" });
      }

      // Buscar creator por publicId
      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      // Si el anónimo dio alias, usarlo, si no generar token único
      const anonToken = alias ? alias : crypto.randomUUID();

      // Buscar chat existente con ese anonToken
      let chat = await prisma.chat.findFirst({
        where: { creatorId: creator.id, anonToken },
      });

      // Si no existe el chat, crearlo
      if (!chat) {
        chat = await prisma.chat.create({
          data: {
            creatorId: creator.id,
            anonToken,
          },
        });
      }

      // Crear el mensaje en la BD
      const message = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          alias: alias || null, // 🔑 Guardamos null si no manda alias
          content,
        },
      });

      reply.code(201).send({
        success: true,
        chatId: chat.id,
        anonToken,
        creatorName: creator.name,
        message: {
          id: message.id,
          content: message.content,
          alias: message.alias || "Anónimo",
          createdAt: message.createdAt,
        },
      });
    } catch (err) {
      fastify.log.error("❌ Error en /public/:publicId/messages:", err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });
}

module.exports = publicRoutes;
