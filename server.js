// ======================
// Dependencias principales
// ======================
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const rateLimit = require("@fastify/rate-limit");
const websocket = require("@fastify/websocket");
const crypto = require("crypto");

// ======================
// Plugins y Rutas (Asegúrate de que las rutas existan en tu proyecto)
// ======================
const authPlugin = require("./plugins/auth");
const creatorsRoutes = require("./routes/creators");
const chatsRoutes = require("./routes/chats");
const messagesRoutes = require("./routes/messages");
const publicRoutes = require("./routes/public");
const dashboardChats = require("./routes/dashboardChats");
const subscribe = require("./routes/subscribe");
const premiumDummyRoutes = require("./routes/premiumDummy");

// ======================
// Crear instancia Fastify
// ======================
const fastify = Fastify({ logger: true, trustProxy: true });

// ======================
// Seguridad y Middlewares
// ======================
fastify.register(helmet);
fastify.register(cors, {
  origin: (origin, cb) => {
    const allowedOrigins = [
      "http://localhost:3000",
      "https://ghost-web-two.vercel.app",
    ];
    if (!origin || allowedOrigins.includes(origin) || (typeof origin === "string" && origin.includes("vercel.app"))) {
      cb(null, true);
    } else {
      cb(new Error("Origen no permitido por CORS"), false);
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
fastify.register(rateLimit, { max: 100, timeWindow: "1 minute" });

// ======================
// WebSocket
// ======================
fastify.register(websocket);

// =================================================================
// ===== INICIO DE LA LÓGICA DE WEBSOCKET DE DEPURACIÓN ============
// =================================================================

fastify.get("/ws/chat", { websocket: true }, (connection, req) => {
  // El objeto 'connection' es el stream, el socket real está en 'connection.socket'
  const { socket } = connection;

  fastify.log.info("Intento de conexión WebSocket recibido.");

  // GUARDIÁN: Verificamos si el objeto socket es válido ANTES de usarlo.
  if (!socket || typeof socket.send !== 'function') {
    fastify.log.error({
        hasSocket: !!socket,
        socketKeys: socket ? Object.keys(socket) : "socket is null/undefined"
    }, "Objeto 'socket' inválido o no tiene el método .send(). Abortando conexión.");
    // No podemos enviar un mensaje de error si .send no existe, así que solo cerramos si es posible.
    if (socket && typeof socket.close === 'function') {
        socket.close(1011, "Error interno del servidor al inicializar.");
    }
    return;
  }

  fastify.log.info("El objeto 'socket' parece válido. Procediendo a configurar listeners.");

  // Si llegamos aquí, 'socket' es un objeto con un método 'send'.
  try {
    socket.send(JSON.stringify({ message: "¡Hola! La conexión WebSocket está funcionando." }));

    socket.on("message", (message) => {
      fastify.log.info(`Mensaje recibido: ${message}`);
      // Simplemente devolvemos el mensaje al cliente.
      socket.send(JSON.stringify({ reply: `Recibiste: ${message}` }));
    });

    socket.on("close", () => {
      fastify.log.info("Cliente WebSocket desconectado.");
    });

    socket.on("error", (err) => {
      fastify.log.error({ err }, "Error en la conexión WebSocket.");
    });

  } catch (err) {
      fastify.log.error({ err }, "Ocurrió un error después de la validación inicial del socket.");
  }
});


// ===============================================================
// ===== FIN DE LA LÓGICA DE WEBSOCKET DE DEPURACIÓN =============
// ===============================================================

// ======================
// Plugins y Rutas REST
// ======================
fastify.register(authPlugin);
fastify.register(creatorsRoutes);
fastify.register(chatsRoutes);
fastify.register(messagesRoutes);
fastify.register(publicRoutes);
fastify.register(dashboardChats);
fastify.register(subscribe);
fastify.register(premiumDummyRoutes);

// Rutas de Healthcheck
fastify.get("/", async () => ({ status: "API online", timestamp: Date.now() }));
fastify.get("/healthz", async () => ({ ok: true, timestamp: Date.now() }));

// ======================
// Iniciar Servidor
// ======================
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