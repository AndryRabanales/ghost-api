// routes/subscribe.js
const fp = require("fastify-plugin");
const mercadopago = require("mercadopago");

// 👉 cliente nuevo
const client = new mercadopago.MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

async function subscribeRoutes(fastify, opts) {
  fastify.post("/subscribe", async (req, reply) => {
    try {
      const preference = new mercadopago.Preference(client);

      const result = await preference.create({
        body: {
          items: [
            {
              title: "Suscripción Premium",
              quantity: 1,
              unit_price: 99, // 💵 precio
            },
          ],
          back_urls: {
            success: "https://ghost-web-two.vercel.app/success",
            failure: "https://ghost-web-two.vercel.app/failure",
          },
          auto_return: "approved",
        },
      });

      return reply.send({ init_point: result.init_point });
    } catch (err) {
      fastify.log.error("❌ Error en /subscribe:", err);
      return reply.code(500).send({ error: "Error creando preferencia" });
    }
  });
}

module.exports = fp(subscribeRoutes);
