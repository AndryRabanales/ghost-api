// routes/dashboardChats.js
// ... (imports)

async function dashboardChatsRoutes(fastify, opts) {

  // ... (rutas POST /dashboard/:dashboardId/chats/:chatId/messages y GET sin cambios) ...

  /**
   * Abrir un chat (Ahora solo marca como abierto, no falla por vidas)
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
        // Ejecutamos consumeLife: ahora devuelve al creador sin consumir 
        // vidas para GRATUITOS o PREMIUM, cumpliendo la regla de "sin limitaciones".
        updatedCreator = await consumeLife(dashboardId); 
        
        await prisma.chat.update({
          where: { id: chatId },
          data: { isOpened: true },
        });

      } else {
        // Si ya estaba abierto, solo traemos los datos actualizados del creador.
        updatedCreator = await prisma.creator.findUnique({ where: { id: dashboardId } });
        updatedCreator = await refillLivesIfNeeded(updatedCreator); 
      }

      reply.send({
        ok: true,
        // Estos valores seguirán siendo "vidas ilimitadas" para Premium y Gratuitos
        livesLeft: updatedCreator.lives, 
        minutesToNextLife: minutesToNextLife(updatedCreator),
      });
      
    } catch (err) {
      // El único error que puede quedar aquí es "Creator no encontrado" (500)
      fastify.log.error("❌ Error en POST /dashboard/:dashboardId/chats/:chatId/open:", err);
      reply.code(500).send({ error: "Error abriendo chat" });
    }
  });
}

module.exports = dashboardChatsRoutes;