// utils/expoPush.js — envío de notificaciones a la app nativa (Expo Push API)
// No requiere SDK: es un POST simple a exp.host. Los tokens inválidos se limpian.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Envía una push a todos los dispositivos del creador.
 * data.chatId permite que la app abra el chat correcto al tocarla.
 */
async function sendPushToCreator(prisma, creatorId, { title, body, chatId }) {
  const tokens = await prisma.creatorPushToken.findMany({
    where: { creatorId },
    select: { token: true },
  });
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default",
    title,
    body: (body || "").slice(0, 150),
    badge: 1,
    data: { chatId: chatId || null, url: chatId ? `/chat/${chatId}` : "/inbox" },
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    const result = await res.json().catch(() => null);

    // Limpia tokens que Expo marca como no registrados (app desinstalada).
    const tickets = result?.data;
    if (Array.isArray(tickets)) {
      const dead = [];
      tickets.forEach((ticket, i) => {
        if (ticket?.details?.error === "DeviceNotRegistered") {
          dead.push(messages[i].to);
        }
      });
      if (dead.length > 0) {
        await prisma.creatorPushToken.deleteMany({ where: { token: { in: dead } } });
      }
    }
  } catch (err) {
    // La push nunca debe tumbar el envío del mensaje.
    console.error("Error enviando push Expo:", err.message);
  }
}

module.exports = { sendPushToCreator };
