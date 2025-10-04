const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const rateLimit = require("@fastify/rate-limit");
const websocket = require("@fastify/websocket");

// Importaciones de Plugins y Rutas
const authPlugin = require("./plugins/auth");
const websocketPlugin = require("./plugins/websocket"); // <-- Nuestro plugin
const creatorsRoutes = require("./routes/creators");
const chatsRoutes = require("./routes/chats");
const messagesRoutes = require("./routes/messages");
const publicRoutes = require("./routes/public");
const dashboardChats = require("./routes/dashboardChats");
const subscribe = require("./routes/subscribe");
const premiumDummyRoutes = require("./routes/premiumDummy");

const fastify = Fastify({ logger: true, trustProxy: true });

// Registro de Middlewares
fastify.register(helmet);
fastify.register(cors, { origin: true });
fastify.register(rateLimit, { max: 100, timeWindow: "1 minute" });

// Registro de Plugins Principales
fastify.register(websocket); // Carga el plugin base de websocket
fastify.register(websocketPlugin); // Carga nuestro plugin con la lógica y la ruta

// Registro de Rutas de la API REST
fastify.register(authPlugin);
fastify.register(creatorsRoutes);
fastify.register(chatsRoutes);
fastify.register(messagesRoutes);
fastify.register(publicRoutes);
fastify.register(dashboardChats);
fastify.register(subscribe);
fastify.register(premiumDummyRoutes);

// Función para iniciar el servidor
const start = async () => {
  try {
    const port = process.env.PORT || 8080;
    await fastify.listen({ port, host: "0.0.0.0" });
    // El log de "listening" lo hará Fastify automáticamente.
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// ¡Ejecutar el servidor!
start();