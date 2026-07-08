// utils/push.js
const webpush = require("web-push");

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:soporte@ghostmsg.space";

if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

async function sendPushToChat(prisma, chatId, payload) {
  if (!publicKey || !privateKey) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { chatId } });
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body
        );
      } catch (err) {
        // Suscripción vencida/inválida (410/404) -> limpiar
        if (err.statusCode === 410 || err.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    })
  );
}

module.exports = { sendPushToChat, publicKey };
