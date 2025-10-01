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

ffastify.register(cors, (instance) => {
  return (req, cb) => {
    const allowedOrigins = [
      "http://localhost:3000",
      "https://ghost-web-two.vercel.app",
    ];

    let origin = req.headers.origin;

    // 👇 rutas públicas aceptan todos los orígenes
    if (req.url.startsWith("/public")) {
      cb(null, {
        origin: true, // permite cualquiera
        methods: ["GET", "POST", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
      });
      return;
    }

    // 👇 rutas privadas (dashboard, creators, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, {
        origin: true,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
      });
    } else {
      cb(new Error("Not allowed by CORS"), false);
    }
  };
});

// ✅ agregado: registrar también cors con fastify (sin tocar el tuyo)
fastify.register(cors, {
  origin: true,
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
fastify.register(require("./routes/dashboardChats"));
fastify.register(require("./routes/subscribe"));

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
