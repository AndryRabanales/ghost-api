// server.js (Versión Final y Corregida)

const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const rateLimit = require("@fastify/rate-limit");
const websocket = require("@fastify/websocket");

// --- 1. IMPORTAR RUTAS Y PLUGINS ---
// Se eliminó la importación duplicada de authPlugin
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

// ===== LA SOLUCIÓN DEFINITIVA A CORS ESTÁ AQUÍ =====
// Configuración de CORS más robusta para permitir peticiones desde tu frontend
fastify.register(cors, {
  origin: ["http://localhost:3000", "https://ghost-web-two.vercel.app"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Se añade OPTIONS para el preflight
  allowedHeaders: ['Content-Type', 'Authorization'],    // Se especifican los encabezados permitidos
  credentials: true,                                     // Permite el envío de credenciales (cookies, etc.)
});
// =====================================================

fastify.register(rateLimit, { max: 100, timeWindow: "1 minute" });

// Plugins principales de la aplicación
fastify.register(websocket);
fastify.register(websocketPlugin);
// El plugin de autenticación ahora se registra correctamente desde routes/auth.js

// --- 3. REGISTRAR TODAS LAS RUTAS (una sola vez) ---
// Se eliminó el registro duplicado de authPlugin
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