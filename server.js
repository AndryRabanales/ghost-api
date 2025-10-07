// server.js (Versión Definitiva con CORS Dinámico)

const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const rateLimit = require("@fastify/rate-limit");
const websocket = require("@fastify/websocket");

// --- 1. IMPORTAR RUTAS Y PLUGINS ---
const websocketPlugin = require("./plugins/websocket");
const authRoutes = require("./routes/auth");
const creatorsRoutes = require("./routes/creators");
const chatsRoutes = require("./routes/chats");
const messagesRoutes = require("./routes/messages");
const publicRoutes = require("./routes/public");
const dashboardChats = require("./routes/dashboardChats");
const premiumPayments = require("./routes/premiumPayments");
const premiumWebhook = require("./routes/premiumWebhook");

const fastify = Fastify({ logger: true, trustProxy: true });

// --- 2. REGISTRAR MIDDLEWARES Y PLUGINS ---
fastify.register(helmet);

// ===== CONFIGURACIÓN DE CORS DINÁMICA (SOLUCIÓN RECOMENDADA) =====
const allowedOrigins = ["http://localhost:3000", "https://ghost-web-two.vercel.app"];

fastify.register(cors, {
  origin: (origin, callback) => {
    // Si la solicitud no tiene 'origin' (ej. Postman, o misma máquina), se permite.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      fastify.log.error(`CORS: Origen bloqueado -> ${origin}`);
      callback(new Error("No permitido por CORS"), false);
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});
// =================================================================

fastify.register(rateLimit, { max: 100, timeWindow: "1 minute" });
fastify.register(websocket);
fastify.register(websocketPlugin);

// --- 3. REGISTRAR TODAS LAS RUTAS ---
fastify.register(authRoutes);
fastify.register(creatorsRoutes);
fastify.register(chatsRoutes);
fastify.register(messagesRoutes);
fastify.register(publicRoutes);
fastify.register(dashboardChats);
fastify.register(premiumPayments);
fastify.register(premiumWebhook);

// --- 4. INICIAR EL SERVIDOR ---
const start = async () => {
  try {
    const port = process.env.PORT || 8080;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`Servidor escuchando en el puerto ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();