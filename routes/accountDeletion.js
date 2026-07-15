// routes/accountDeletion.js — autoservicio de eliminación de cuenta (requisito
// de Play Store / App Store). Verifica identidad con el mismo login de Google
// y borra al creador y todos sus datos asociados en cascada.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { OAuth2Client } = require("google-auth-library");

const WEB_CLIENT_ID =
  "139854990044-ihq8knm8q3nk39vc5oebuorikdc01u14.apps.googleusercontent.com";
const googleClient = new OAuth2Client();

// Borra TODO el contenido del creador (chats, mensajes, reportes) pero conserva
// la cuenta. Sirve para "eliminar mis datos sin eliminar mi cuenta".
async function deleteCreatorContent(creatorId) {
  const messages = await prisma.message.findMany({
    where: { creatorId },
    select: { id: true },
  });
  const messageIds = messages.map((m) => m.id);

  await prisma.$transaction([
    prisma.response.deleteMany({ where: { messageId: { in: messageIds } } }),
    prisma.message.deleteMany({ where: { creatorId } }),
    prisma.report.deleteMany({ where: { creatorId } }),
    // Chat -> ChatMessage/PushSubscription ya tienen onDelete: Cascade.
    prisma.chat.deleteMany({ where: { creatorId } }),
  ]);
}

async function deleteCreatorAndData(creatorId) {
  await deleteCreatorContent(creatorId);
  // Además de su contenido, borra la cuenta y lo ligado a ella.
  await prisma.$transaction([
    prisma.productLink.deleteMany({ where: { creatorId } }),
    prisma.creatorPushToken.deleteMany({ where: { creatorId } }),
    prisma.creator.delete({ where: { id: creatorId } }),
  ]);
}

async function accountDeletionRoutes(fastify, opts) {
  /**
   * Autoservicio público: el usuario se identifica con Google (mismo flujo de
   * login) y su cuenta + todos sus chats/mensajes se eliminan de inmediato.
   */
  fastify.post("/account/delete-with-google", async (req, reply) => {
    const { credential } = req.body || {};
    if (!credential) {
      return reply.code(400).send({ error: "Falta el token de Google" });
    }

    const audience = [
      process.env.GOOGLE_CLIENT_ID || WEB_CLIENT_ID,
      process.env.GOOGLE_IOS_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
    ].filter(Boolean);

    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience });
      const payload = ticket.getPayload();
      if (!payload?.email) {
        return reply.code(401).send({ error: "Token de Google inválido" });
      }

      const creator = await prisma.creator.findUnique({ where: { email: payload.email } });
      if (!creator) {
        // No revelamos si el correo existe o no; para el usuario, "ya no hay nada que borrar".
        return reply.send({ success: true, message: "No se encontró ninguna cuenta con ese correo." });
      }

      await deleteCreatorAndData(creator.id);

      fastify.log.info(`Cuenta eliminada por autoservicio: ${creator.id}`);
      reply.send({ success: true, message: "Tu cuenta y todos tus datos fueron eliminados." });
    } catch (err) {
      fastify.log.error(err, "Error en POST /account/delete-with-google");
      reply.code(500).send({ error: "No se pudo procesar la eliminación. Intenta de nuevo." });
    }
  });

  /**
   * Autoservicio público: borra el CONTENIDO del usuario (chats y mensajes)
   * pero conserva su cuenta. El usuario se identifica con Google.
   */
  fastify.post("/account/delete-data-with-google", async (req, reply) => {
    const { credential } = req.body || {};
    if (!credential) {
      return reply.code(400).send({ error: "Falta el token de Google" });
    }

    const audience = [
      process.env.GOOGLE_CLIENT_ID || WEB_CLIENT_ID,
      process.env.GOOGLE_IOS_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
    ].filter(Boolean);

    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience });
      const payload = ticket.getPayload();
      if (!payload?.email) {
        return reply.code(401).send({ error: "Token de Google inválido" });
      }

      const creator = await prisma.creator.findUnique({ where: { email: payload.email } });
      if (!creator) {
        return reply.send({ success: true, message: "No se encontró ninguna cuenta con ese correo." });
      }

      await deleteCreatorContent(creator.id);

      fastify.log.info(`Contenido eliminado por autoservicio: ${creator.id}`);
      reply.send({ success: true, message: "Tus chats y mensajes fueron eliminados. Tu cuenta sigue activa." });
    } catch (err) {
      fastify.log.error(err, "Error en POST /account/delete-data-with-google");
      reply.code(500).send({ error: "No se pudo procesar la solicitud. Intenta de nuevo." });
    }
  });

  /**
   * Eliminación desde dentro de la app/dashboard (ya con sesión iniciada).
   */
  fastify.delete(
    "/creators/me",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        await deleteCreatorAndData(req.user.id);
        reply.send({ success: true });
      } catch (err) {
        fastify.log.error(err, "Error en DELETE /creators/me");
        reply.code(500).send({ error: "No se pudo eliminar la cuenta." });
      }
    }
  );
}

module.exports = accountDeletionRoutes;
