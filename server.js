// server.js - Versión Simplificada para Pruebas
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const websocket = require("@fastify/websocket");

// --- IMPORTAR RUTAS Y PLUGINS ---
const authPlugin = require("./plugins/auth");
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

// --- CONFIGURACIÓN A PRUEBA DE ERRORES ---
// Se simplifica CORS para permitir cualquier origen durante las pruebas.
// Se eliminan plugins (helmet, rate-limit) que podrían interferir.
fastify.register(cors, { origin: '*' });

// --- PLUGINS ESENCIALES ---
fastify.register(authPlugin);
fastify.register(websocket);
fastify.register(websocketPlugin);

// --- REGISTRAR TODAS LAS RUTAS ---
fastify.register(authRoutes);
fastify.register(creatorsRoutes);
fastify.register(chatsRoutes);
fastify.register(messagesRoutes);
fastify.register(publicRoutes);
fastify.register(dashboardChats);
fastify.register(premiumPayments);
fastify.register(premiumWebhook);

// --- INICIAR EL SERVIDOR ---
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