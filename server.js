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
const publicRoutes = require("./routes/public"); // 👈 nuevo import

const fastify = Fastify({ logger: true });

/* ======================
   Seguridad básica
   ====================== */
fastify.register(helmet);

fastify.register(cors, {
  origin: (origin, cb) => {
    const allowedOrigins = [
      "http://localhost:3000",          // dev local
      "https://ghost-web-two.vercel.app", // producción Vercel
    ];

    // permitir requests sin origin (como healthchecks de Render)
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error("Not allowed by CORS"), false);
    }
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
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
fastify.register(publicRoutes); // 👈 aquí lo registras

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

fastify.register(require("./routes/dashboardChats"));


start();
