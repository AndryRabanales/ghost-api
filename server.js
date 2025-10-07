// server.js (Versión Final y Limpia)

const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const rateLimit = require("@fastify/rate-limit");
const websocket = require("@fastify/websocket");

// --- 1. IMPORTAR RUTAS Y PLUGINS ---
const websocketPlugin = require("./plugins/websocket");

const authRoutes = require("./routes/auth"); // Rutas para registro y login
const creatorsRoutes = require("./routes/creators");
const chatsRoutes = require("./routes/chats");
const messagesRoutes = require("./routes/messages");
const publicRoutes = require("./routes/public");
const dashboardChats = require("./routes/dashboardChats");
const premiumPayments = require("./routes/premiumPayments"); // Ruta para crear suscripciones
const premiumWebhook = require("./routes/premiumWebhook");   // Ruta para notificaciones seguras de MP

const fastify = Fastify({ logger: true, trustProxy: true });

// --- 2. REGISTRAR MIDDLEWARES Y PLUGINS ---
fastify.register(helmet);

// Configuración de CORS para permitir peticiones desde tu frontend
fastify.register(cors, {
  origin: ["http://localhost:3000", "https://ghost-web-two.vercel.app"],
  methods: ["GET", "POST", "PUT", "DELETE"],
});

fastify.register(rateLimit, { max: 100, timeWindow: "1 minute" });

// Plugins principales de la aplicación
fastify.register(websocket);
fastify.register(websocketPlugin);

// --- 3. REGISTRAR TODAS LAS RUTAS (una sola vez) ---
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
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();