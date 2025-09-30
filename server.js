// server.js
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const rateLimit = require("@fastify/rate-limit");

// Plugins y rutas
const authPlugin = require("./plugins/auth");
const creatorsRoutes = require("./routes/creators");
const chatsRoutes = require("./routes/chats");
const messagesRoutes = require("./routes/messages");

const fastify = Fastify({ logger: true });

/* ======================
   Seguridad básica
   ====================== */
fastify.register(helmet);

fastify.register(cors, {
  origin: [
    "http://localhost:3000", // dev local
    process.env.FRONTEND_URL || "https://tu-front.vercel.app", // front en producción
  ],
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
});

fastify.register(rateLimit, {
  max: 60, // 60 req/min por IP
  timeWindow: "1 minute",
});

/* ======================
   Plugins
   ====================== */
fastify.register(authPlugin);

/* ======================
   Rutas
   ====================== */
fastify.register(creatorsRoutes);
fastify.register(chatsRoutes);
fastify.register(messagesRoutes);

/* ======================
   Healthcheck
   ====================== */
fastify.get("/", async () => ({ status: "API ok" }));

/* ======================
   Start
   ====================== */
const start = async () => {
  try {
    await fastify.listen({
      port: process.env.PORT || 3001,
      host: "0.0.0.0", // necesario para Render
    });
    fastify.log.info(
      `🚀 Servidor corriendo en puerto ${process.env.PORT || 3001}`
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
