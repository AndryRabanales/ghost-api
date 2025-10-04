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
    cb(new Error("Not allowed"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

fastify.register(rateLimit, { max: 60, timeWindow: "1 minute" });

// ======================
// Hooks globales
// ======================
fastify.addHook("onRequest", (req, reply, done) => {
  if (req.headers.upgrade && String(req.headers.upgrade).toLowerCase() === "websocket") {
    try {
      reply.raw.setHeader("Connection", "Upgrade");
      reply.raw.setHeader("Upgrade", "websocket");
      reply.raw.setHeader("Sec-WebSocket-Version", "13");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Pragma", "no-cache");
    } catch (e) {
      fastify.log.error(e, "❌ Error configurando headers WS");
    }
  }
  done();
});

// ======================
// WebSocket
// ======================
fastify.register(websocket, {
  options: {
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  },
});

// ======================
// Estructuras WS
// ======================
const chatRooms = new Map(); // Map<chatId, Set<ws>>
const socketState = new WeakMap(); // WeakMap<ws, {chatId, anonToken, messagesCount, createdAt, lastPongAt, closed}>
const chatHistory = new Map(); // Map<chatId, Array<{from, alias, content, createdAt}>>

// ======================
// Funciones auxiliares
// ======================
const generateAnonToken = () => crypto.randomBytes(8).toString("hex");

const broadcastMessage = (chatId, payload) => {
  const clients = chatRooms.get(chatId) || new Set();
  for (const client of clients) {
    try {
      if (client.readyState === 1) client.send(JSON.stringify(payload));
    } catch {}
  }
  // Guardar en historial (últimos 100 mensajes)
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  const history = chatHistory.get(chatId);
  history.push(payload);
  if (history.length > 100) history.shift();
};

// ======================
// WS Chat con rooms, reconexión y historial
// ======================
fastify.get("/ws/chat", { websocket: true }, (connection, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatId = url.searchParams.get("chatId") || "default";
    const anonToken = url.searchParams.get("anonToken") || generateAnonToken();
    const origin = req.headers.origin || "";
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    const proto = req.headers["x-forwarded-proto"] || (req.protocol || "http");

    // ✅ Validación de origin
    const allowedOrigins = ["http://localhost:3000","https://ghost-web-two.vercel.app"];
    if (origin && !(allowedOrigins.includes(origin) || origin.includes("vercel.app"))) {
      try { connection.socket.send(JSON.stringify({ type: "error", error: "origin_not_allowed" })); } catch {}
      connection.socket.close();
      return;
    }

    if (!chatRooms.has(chatId)) chatRooms.set(chatId, new Set());
    chatRooms.get(chatId).add(connection.socket);

    socketState.set(connection.socket, {
      chatId,
      anonToken,
      messagesCount: 0,
      createdAt: Date.now(),
      lastPongAt: Date.now(),
      closed: false,
    });

    fastify.log.info(`🔌 Cliente conectado chat=${chatId} ip=${ip} proto=${proto} origin=${origin || "none"} anon=${anonToken}`);

    // Enviar historial al nuevo cliente
    if (chatHistory.has(chatId)) {
      const history = chatHistory.get(chatId);
      try { connection.socket.send(JSON.stringify({ type: "history", messages: history })); } catch {}
    }

    // Mensaje de bienvenida
    connection.socket.send(JSON.stringify({
      type: "welcome",
      chatId,
      anonToken,
      serverTime: new Date().toISOString(),
      msg: "WS conectado 🚀",
    }));

    // Ping/Pong keep-alive
    const PING_INTERVAL_MS = 25_000;
    const PONG_TIMEOUT_MS = 60_000;

    const pingTimer = setInterval(() => {
      const st = socketState.get(connection.socket);
      if (!st || st.closed) return;
      if (Date.now() - st.lastPongAt > PONG_TIMEOUT_MS) {
        fastify.log.warn(`⏱️ WS sin pong, cerrando chat=${chatId}`);
        connection.socket.close();
        clearInterval(pingTimer);
      } else {
        try { connection.socket.ping?.(); } catch {}
        try { connection.socket.send(JSON.stringify({ type: "ping", t: Date.now() })); } catch {}
      }
    }, PING_INTERVAL_MS);

    connection.socket.on("pong", () => {
      const st = socketState.get(connection.socket);
      if (st) st.lastPongAt = Date.now();
    });

    // Manejo de mensajes
    connection.socket.on("message", (raw) => {
      let parsed;
      try { parsed = JSON.parse(raw.toString()); } catch { parsed = { content: raw.toString() }; }
      const MAX_LEN = 4000;
      const safeContent = typeof parsed.content === "string" ? parsed.content.slice(0, MAX_LEN) : String(parsed.content ?? "").slice(0, MAX_LEN);
      const payload = {
        type: "message",
        chatId,
        from: parsed.from || anonToken,
        alias: parsed.alias || "Anónimo",
        content: safeContent,
        createdAt: new Date(),
      };
      const st = socketState.get(connection.socket);
      if (st) {
        st.messagesCount++;
        if (st.messagesCount % 200 === 0) fastify.log.warn(`⚠️ Flood posible en chat=${chatId} msgs=${st.messagesCount}`);
      }
      broadcastMessage(chatId, payload);
      fastify.log.info(`📩 [${chatId}] ${safeContent}`);
    });

    // Reconexión opcional: el cliente puede enviar WS con mismo anonToken
    connection.socket.on("close", () => {
      const st = socketState.get(connection.socket);
      if (st) st.closed = true;
      chatRooms.get(chatId)?.delete(connection.socket);
      if ((chatRooms.get(chatId)?.size || 0) === 0) chatRooms.delete(chatId);
      clearInterval(pingTimer);
      fastify.log.info(`❌ Cliente salió chat=${chatId}`);
    });

    connection.socket.on("error", (err) => {
      fastify.log.error({ err }, `⚠️ Error WS chat=${chatId}`);
    });

  } catch (err) {
    fastify.log.error({ err }, "❌ Error inicializando WebSocket");
    try { connection.socket.send(JSON.stringify({ type: "error", error: "init_failed" })); } catch {}
    try { connection.socket.close(); } catch {}
  }
});

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
fastify.register(require("./routes/premiumDummy"));

// ======================
// Debug y healthcheck extendido
// ======================
fastify.get("/", async () => ({ status: "API ok", ts: Date.now() }));

fastify.get("/_debug/ws/rooms", async () => {
  const out = [];
  for (const [roomId, set] of chatRooms.entries()) {
    out.push({ roomId, clients: set.size });
  }
  return { rooms: out, totalRooms: out.length };
});

fastify.get("/_debug/ws/sockets", async () => {
  const stats = [];
  for (const [roomId, set] of chatRooms.entries()) {
    for (const sock of set.values()) {
      const st = socketState.get(sock) || {};
      stats.push({
        roomId,
        createdAt: st.createdAt ? new Date(st.createdAt).toISOString() : null,
        lastPongAt: st.lastPongAt ? new Date(st.lastPongAt).toISOString() : null,
        messagesCount: st.messagesCount || 0,
        anonToken: st.anonToken || null,
        readyState: sock.readyState,
      });
    }
  }
  return { total: stats.length, sockets: stats };
});

fastify.get("/healthz", async () => ({ ok: true, ts: Date.now() }));
fastify.get("/.well-known/health", async () => ({ status: "ok", ts: Date.now() }));

// ======================
// Broadcast interno seguro con room y historial
// ======================
fastify.post("/_internal/broadcast", async (req, reply) => {
  const key = req.headers["x-internal-key"];
  const expected = process.env.INTERNAL_BROADCAST_KEY || null;
  if (expected && key !== expected) return reply.code(401).send({ error: "unauthorized" });

  const { chatId, content, from, alias } = req.body || {};
  if (!chatId || !content) return reply.code(400).send({ error: "chatId y content son requeridos" });

  const payload = {
    type: "message",
    chatId,
    from: from || "system",
    alias: alias || "Sistema",
    content: String(content).slice(0, 4000),
    createdAt: new Date(),
  };
  broadcastMessage(chatId, payload);
  return { ok: true, delivered: chatRooms.get(chatId)?.size || 0 };
});

// ======================
// Apagado elegante
// ======================
const shutdown = async (signal) => {
  try {
    fastify.log.warn(`Recibida señal ${signal}, cerrando WS y servidor...`);
    for (const [, set] of chatRooms.entries()) {
      for (const sock of set.values()) try { sock.close(); } catch {}
      set.clear();
    }
    chatRooms.clear();
    await fastify.close();
    process.exit(0);
  } catch (e) {
    fastify.log.error("Error en shutdown:", e);
    process.exit(1);
  }
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ======================
// Start
// ======================
const start = async () => {
  try {
    const port = process.env.PORT || 8080;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`🚀 Servidor corriendo en puerto ${port}`);
    fastify.log.info("✅ Fastify listo. Prueba WS en: wss://<tu-dominio>/ws/chat?chatId=test");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
