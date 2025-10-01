// routes/subscribe.js
const mercadopago = require("mercadopago");

async function subscribeRoutes(fastify, opts) {
  // Configurar el SDK con tu Access Token
  mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN,
  });

  /**
   * Crear suscripción/pago único
   */
  fastify.post("/subscribe", async (req, reply) => {
    try {
      const preference = {
        items: [
          {
            title: "Suscripción Premium Ghost",
            unit_price: 99, // 💵 precio en pesos MXN
            quantity: 1,
          },
        ],
        back_urls: {
          success: process.env.FRONTEND_URL + "/premium/success",
          failure: process.env.FRONTEND_URL + "/premium/failure",
          pending: process.env.FRONTEND_URL + "/premium/pending",
        },
        auto_return: "approved",
      };

      const response = await mercadopago.preferences.create(preference);

      return { id: response.body.id, init_point: response.body.init_point };
    } catch (err) {
      req.log.error("❌ Error creando preferencia:", err);
      return reply.code(500).send({ error: "Error creando preferencia de pago" });
    }
  });
}

module.exports = subscribeRoutes;
