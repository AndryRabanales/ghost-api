const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const rateLimit = require("@fastify/rate-limit");
const websocket = require("@fastify/websocket");

// --- 1. IMPORTAR LAS RUTAS QUE FALTABAN ---
const authPlugin = require("./plugins/auth");
const websocketPlugin = require("./plugins/websocket");
const creatorsRoutes = require("./routes/creators");
const chatsRoutes = require("./routes/chats");
const messagesRoutes = require("./routes/messages");
const publicRoutes = require("./routes/public");
const dashboardChats = require("./routes/dashboardChats");
const subscribe = require("./routes/subscribe");
const premiumDummyRoutes = require("./routes/premiumDummy");
const premiumPayments = require("./routes/premiumPayments"); // <-- AÑADIDO
const premiumWebhook = require("./routes/premiumWebhook");   // <-- AÑADIDO

const fastify = Fastify({ logger: true, trustProxy: true });

// Middlewares
fastify.register(helmet);
fastify.register(cors, { origin: true });
fastify.register(rateLimit, { max: 100, timeWindow: "1 minute" });

// Plugins principales
fastify.register(websocket);
fastify.register(websocketPlugin);

// --- 2. REGISTRAR LAS RUTAS QUE FALTABAN ---
fastify.register(authPlugin);
fastify.register(creatorsRoutes);
fastify.register(chatsRoutes);
fastify.register(messagesRoutes);
fastify.register(publicRoutes);
fastify.register(dashboardChats);
fastify.register(subscribe);
fastify.register(premiumDummyRoutes);
fastify.register(premiumPayments); // <-- AÑADIDO
fastify.register(premiumWebhook);   // <-- AÑADIDO


// Iniciar el Servidor
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