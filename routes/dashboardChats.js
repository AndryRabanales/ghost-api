// andryrabanales/ghost-api/ghost-api-282b77c99f664dcc9acae14a9880ffdd34fc9b54/routes/dashboardChats.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ✅ CORRECCIÓN: Importación segura de lives.js
const livesUtils = require("../utils/lives");

const { sanitize } = require("../utils/sanitize");
const { sendPushToChat } = require("../utils/push");
// Importación de IA eliminada

async function dashboardChatsRoutes(fastify, opts) {

  /**
   * Enviar mensaje como creador (LIBERA FONDOS)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/messages", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;

      const cleanContent = sanitize(req.body.content);

      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      if (!cleanContent || cleanContent.trim().length < 1) {
        return reply.code(400).send({ error: "El mensaje está vacío." });
      }

      // Validación de IA eliminada

      const chat = await prisma.chat.findUnique({
        where: { id: chatId }
      });

      if (!chat || chat.creatorId !== dashboardId) {
        return reply.code(404).send({ error: "Chat no encontrado o no pertenece al creador" });
      }

      const msg = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "creator",
          content: cleanContent,
        },
      });



      // Actualiza el estado activo del creador
      await prisma.creator.update({
        where: { id: dashboardId },
        data: { lastActive: new Date() }
      });

      const payload = {
        type: "message",
        ...msg,
      };
      fastify.broadcastToChat(chat.id, payload);
      fastify.broadcastToDashboard(chat.creatorId, payload);

      sendPushToChat(prisma, chat.id, {
        title: `${req.user.name || "Alguien"} te respondió`,
        body: cleanContent.slice(0, 120),
        url: `/chats/${chat.anonToken}/${chat.id}`,
      }).catch((err) => fastify.log.error(err, "Error enviando push"));

      reply.code(201).send(msg);
    } catch (err) {
      fastify.log.error("❌ Error en POST /dashboard/:dashboardId/chats/:chatId/messages:", err);
      reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });

  /**
   * Obtener todos los mensajes de un chat (lado creador)
   */
  fastify.get("/dashboard/:dashboardId/chats/:chatId", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;

      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      let creator = await prisma.creator.findUnique({ where: { id: dashboardId } });
      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      creator = await livesUtils.refillLivesIfNeeded(creator);

      let chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado" });
      }

      // Resetear anonReplied a false al ver el chat
      if (chat.anonReplied) {
        await prisma.chat.update({
          where: { id: chatId },
          data: { anonReplied: false },
        });
        chat = await prisma.chat.findFirst({
          where: { id: chatId, creatorId: dashboardId },
          include: {
            messages: { orderBy: { createdAt: "asc" } },
          },
        });
      }

      let tipExpiresInMinutes = null;

      reply.send({
        id: chat.id,
        anonToken: chat.anonToken,
        anonAlias: chat.anonAlias,
        messages: chat.messages.map((m) => ({
          id: m.id,
          from: m.from,
          alias: m.alias || chat.anonAlias || "Anónimo",
          content: m.content,
          createdAt: m.createdAt,
          imageUrl: m.imageUrl || null,
          mediaType: m.mediaType || null
        })),
        livesLeft: creator.lives,
        // ✅ Usamos la función a través del objeto importado
        minutesToNextLife: livesUtils.minutesToNextLife(creator),
        tipExpiresInMinutes: tipExpiresInMinutes,
        expiresAt: chat.expiresAt || null,
      });
    } catch (err) {
      fastify.log.error("❌ Error en GET /dashboard/:dashboardId/chats/:chatId:", err);
      reply.code(500).send({ error: "Error obteniendo chat" });
    }
  });

  /**
   * Abrir un chat (Asegura vidas ilimitadas para todos)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/open", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const { dashboardId, chatId } = req.params;

    if (req.user.id !== dashboardId) {
      return reply.code(403).send({ error: "No autorizado" });
    }

    try {
      let chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
      });

      if (!chat) {
        return reply.code(404).send({ error: "Chat no encontrado" });
      }

      let updatedCreator;

      if (!chat.isOpened) {
        // ✅ Usamos la función a través del objeto importado
        updatedCreator = await livesUtils.consumeLife(dashboardId);

        await prisma.chat.update({
          where: { id: chatId },
          data: { isOpened: true },
        });
      } else {
        updatedCreator = await prisma.creator.findUnique({ where: { id: dashboardId } });
        // ✅ Usamos la función a través del objeto importado
        updatedCreator = await livesUtils.refillLivesIfNeeded(updatedCreator);
      }

      reply.send({
        ok: true,
        livesLeft: updatedCreator.lives,
        // ✅ Usamos la función a través del objeto importado
        minutesToNextLife: livesUtils.minutesToNextLife(updatedCreator),
      });
    } catch (err) {
      fastify.log.error("❌ Error en POST /dashboard/:dashboardId/chats/:chatId/open:", err);
      reply.code(500).send({ error: "Error abriendo chat" });
    }
  });

  /**
   * Archivar / restaurar un chat (el creador lo oculta de su bandeja)
   */
  fastify.patch("/dashboard/:dashboardId/chats/:chatId/archive", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }
      const archived = !!req.body?.archived;

      const chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
        select: { id: true },
      });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      await prisma.chat.update({
        where: { id: chatId },
        data: { creatorArchived: archived },
      });

      reply.send({ success: true, id: chatId, archived });
    } catch (err) {
      fastify.log.error("❌ Error en PATCH /dashboard/:dashboardId/chats/:chatId/archive:", err);
      reply.code(500).send({ error: "Error archivando el chat" });
    }
  });

  /**
   * Reportar un mensaje / chat (moderación requerida por las tiendas)
   */
  fastify.post("/dashboard/:dashboardId/chats/:chatId/report", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
        select: { id: true },
      });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      await prisma.report.create({
        data: {
          chatId,
          messageId: req.body?.messageId || null,
          creatorId: dashboardId,
          reason: (req.body?.reason || "").slice(0, 300) || null,
        },
      });
      reply.code(201).send({ success: true });
    } catch (err) {
      fastify.log.error("❌ Error en POST report:", err);
      reply.code(500).send({ error: "Error enviando el reporte" });
    }
  });

  /**
   * Bloquear / desbloquear al anónimo de un chat (deja de aceptar mensajes)
   */
  fastify.patch("/dashboard/:dashboardId/chats/:chatId/block", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }
      const blocked = !!req.body?.blocked;
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
        select: { id: true },
      });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      await prisma.chat.update({ where: { id: chatId }, data: { blocked } });
      reply.send({ success: true, id: chatId, blocked });
    } catch (err) {
      fastify.log.error("❌ Error en PATCH block:", err);
      reply.code(500).send({ error: "Error bloqueando el chat" });
    }
  });

  /**
   * Borrar un chat (el creador lo abandona: se elimina para ambos)
   */
  fastify.delete("/dashboard/:dashboardId/chats/:chatId", {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const { dashboardId, chatId } = req.params;
      if (req.user.id !== dashboardId) {
        return reply.code(403).send({ error: "No autorizado" });
      }

      const chat = await prisma.chat.findFirst({
        where: { id: chatId, creatorId: dashboardId },
        select: { id: true },
      });
      if (!chat) return reply.code(404).send({ error: "Chat no encontrado" });

      // onDelete: Cascade en messages y subscriptions elimina todo lo asociado.
      await prisma.chat.delete({ where: { id: chatId } });

      reply.send({ success: true, id: chatId });
    } catch (err) {
      fastify.log.error("❌ Error en DELETE /dashboard/:dashboardId/chats/:chatId:", err);
      reply.code(500).send({ error: "Error borrando el chat" });
    }
  });
}

module.exports = dashboardChatsRoutes;