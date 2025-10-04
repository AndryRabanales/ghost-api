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
// Plugins y Rutas
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
      return;
    }
    cb(new Error("Origen no permitido por CORS"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

fastify.register(rateLimit, { max: 100, timeWindow: "1 minute" });

// ======================
// WebSocket
// ======================
fastify.register(websocket, {
  options: {
    maxPayload: 1048576, // 1MB
  },
});

// =================================================================
// ===== INICIO DE LA LÓGICA EXTENDIDA DE WEBSOCKET ================
// =================================================================

const chatRooms = new Map();
const socketState = new WeakMap();
const chatHistory = new Map();

const generateAnonToken = () => crypto.randomBytes(8).toString("hex");

const broadcastMessage = (chatId, payload) => {
  const room = chatRooms.get(chatId);
  if (!room) return;
  for (const client of room) {
    try {
      if (client.readyState === 1) {
        client.send(JSON.stringify(payload));
      }
    } catch (err) {
      fastify.log.error(`Error enviando mensaje a un cliente en la sala ${chatId}:`, err);
    }
  }
  if (!chatHistory.has(chatId)) {
    chatHistory.set(chatId, []);
  }
  const history = chatHistory.get(chatId);
  history.push(payload);
  if (history.length > 100) {
    history.shift();
  }
};

fastify.get("/ws/chat", { websocket: true }, (connection, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatId = url.searchParams.get("chatId") || "default";
    const anonToken = url.searchParams.get("anonToken") || generateAnonToken();
    const origin = req.headers.origin || "";
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";

    const allowedOrigins = ["http://localhost:3000", "https://ghost-web-two.vercel.app"];
    if (!allowedOrigins.includes(origin) && origin !== "") {
      fastify.log.warn(`Conexión WS rechazada de origen no permitido: ${origin}`);
      connection.send(JSON.stringify({ type: "error", error: "origin_not_allowed" }));
      connection.close();
      return;
    }

    if (!chatRooms.has(chatId)) {
      chatRooms.set(chatId, new Set());
    }
    const room = chatRooms.get(chatId);
    room.add(connection);

    socketState.set(connection, {
      chatId,
      anonToken,
      messagesCount: 0,
      createdAt: Date.now(),
      lastPongAt: Date.now(),
      closed: false,
    });

    fastify.log.info(`🔌 Cliente conectado: chatId=${chatId}, anonToken=${anonToken}, ip=${ip}, origin=${origin || "ninguno"}`);

    if (chatHistory.has(chatId)) {
      connection.send(JSON.stringify({ type: "history", messages: chatHistory.get(chatId) }));
    }

    connection.send(JSON.stringify({
      type: "welcome",
      chatId,
      anonToken,
      serverTime: new Date().toISOString(),
      message: "Conexión WebSocket establecida con éxito 🚀",
    }));

    const pingInterval = setInterval(() => {
      const state = socketState.get(connection);
      if (state && !state.closed) {
        if (Date.now() - state.lastPongAt > 60000) {
          fastify.log.warn(`Cliente sin respuesta al ping, terminando conexión: chatId=${chatId}`);
          clearInterval(pingInterval);
          return connection.terminate();
        }
        connection.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
    
    connection.on("pong", () => {
      const state = socketState.get(connection);
      if (state) {
        state.lastPongAt = Date.now();
      }
    });

    connection.on("message", (rawMessage) => {
      const state = socketState.get(connection);
      if (!state || state.closed) return;
      try {
        const message = JSON.parse(rawMessage.toString());
        if (!message.content || String(message.content).trim() === "") return;

        const payload = {
          type: "message",
          chatId,
          from: message.from || anonToken,
          alias: String(message.alias || "Anónimo").slice(0, 50),
          content: String(message.content).slice(0, 4000),
          createdAt: new Date(),
        };

        state.messagesCount++;
        broadcastMessage(chatId, payload);
        
      } catch (error) {
        fastify.log.error(`Error procesando mensaje WS malformado: ${error.message}`);
      }
    });

    const cleanup = () => {
      const state = socketState.get(connection);
      if (state && !state.closed) {
        state.closed = true;
        const room = chatRooms.get(chatId);
        if (room) {
          room.delete(connection);
          if (room.size === 0) {
            chatRooms.delete(chatId);
            chatHistory.delete(chatId);
            fastify.log.info(`🚪 Sala de chat vacía y cerrada: ${chatId}`);
          }
        }
        clearInterval(pingInterval);
        fastify.log.info(`❌ Cliente desconectado: chatId=${chatId}`);
      }
    };
    
    connection.on("close", cleanup);
    connection.on("error", (err) => {
      fastify.log.error({ err }, `⚠️ Error en conexión WS, cerrando: chatId=${chatId}`);
      cleanup();
    });

  } catch (err) {
    fastify.log.error({ err }, "❌ Error fatal al inicializar WebSocket");
    if (connection) {
      try {
        connection.close(1011, "Internal server error");
      } catch (closeErr) {
        fastify.log.error({ closeErr }, "Error adicional al intentar cerrar el socket fallido.");
      }
    }
  }
});

// ===============================================================
// ===== FIN DE LA LÓGICA EXTENDIDA DE WEBSOCKET =================
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

// ======================
// Rutas de Healthcheck y Debug
// ======================
fastify.get("/", async () => ({ status: "API online", timestamp: Date.now() }));
fastify.get("/healthz", async () => ({ ok: true, timestamp: Date.now() }));
fastify.get("/_debug/ws/rooms", async () => {
    const rooms = Array.from(chatRooms.entries()).map(([roomId, clients]) => ({
      roomId,
      clientCount: clients.size,
      historySize: chatHistory.get(roomId)?.length || 0,
    }));
    return { totalRooms: rooms.length, rooms };
});

// ======================
// Apagado elegante (Graceful Shutdown)
// ======================
const shutdown = async (signal) => {
  fastify.log.warn(`🚨 Recibida señal ${signal}. Iniciando apagado elegante...`);
  fastify.log.info("Cerrando todas las conexiones WebSocket...");
  for (const client of fastify.websocketServer.clients) {
    client.close(1012, "Servidor reiniciando");
  }
  await fastify.close();
  fastify.log.info("✅ Servidor cerrado correctamente. Adiós.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ======================
// Iniciar Servidor
// ======================
const start = async () => {
  try {
    const port = process.env.PORT || 8080;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`🚀 Servidor escuchando en el puerto ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();