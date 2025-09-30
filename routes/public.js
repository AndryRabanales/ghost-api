// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

async function publicRoutes(fastify, opts) {
  fastify.post("/u/:publicId/send", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const { alias, content } = req.body;

      if (!content) {
        return reply.code(400).send({ error: "Falta el contenido del mensaje" });
      }

      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator) {
        return reply.code(404).send({ error: "Creator no encontrado" });
      }

      // Determinar anonToken (clave única del anónimo)
      const anonToken = alias ? alias : crypto.randomUUID();

      // Buscar chat existente
      let chat = await prisma.chat.findFirst({
        where: { creatorId: creator.id, anonToken },
      });

      // Crear chat si no existe
      if (!chat) {
        chat = await prisma.chat.create({
          data: {
            creatorId: creator.id,
            anonToken,
          },
        });
      }

      // Guardar mensaje
      const message = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          content,
          alias: alias || null,
        },
      });

      reply.code(201).send({
        success: true,
        chatId: chat.id,
        anonToken,
        message,
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });
}

module.exports = publicRoutes;
