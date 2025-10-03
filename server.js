// ======================
// Dependencias principales
// ======================
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const rateLimit = require("@fastify/rate-limit");
const websocket = require("@fastify/websocket");

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
const fastify = Fastify({ logger: true });

/* ======================
   Seguridad y Middlewares
   ====================== */
fastify.register(helmet);

fastify.register(cors, {
  origin: (origin, cb) => {
    const allowedOrigins = [
      "http://localhost:3000",
      "https://ghost-web-two.vercel.app",
    ];
    if (!origin || allowedOrigins.includes(origin) || origin.includes("vercel.app")) {
      cb(null, true);
      return;
    }
    cb(new Error("Not allowed"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

fastify.register(rateLimit, { max: 60, timeWindow: "1 minute" });

/* ======================
   Hooks globales (Railway + WS)
   ====================== */
fastify.addHook("onRequest", (req, reply, done) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === "websocket") {
    reply.raw.setHeader("Connection", "Upgrade");
    reply.raw.setHeader("Upgrade", "websocket");
  }
  done();
});

/* ======================
   WebSocket
   ====================== */
fastify.register(websocket);

const chatRooms = new Map();
const socketState = new WeakMap();

fastify.get("/ws/chat", { websocket: true }, (connection, req) => {
  try {
    req.socket.setKeepAlive(true);

// ✅ Fallback seguro (no depende de req.headers.host)
const url = new URL(req.url, "http://localhost");

    const chatId = url.searchParams.get("chatId");
    const anonToken = url.searchParams.get("anonToken") || null;
    const origin = req.headers.origin || "";
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    const allowedOrigins = [
      "http://localhost:3000",
      "https://ghost-web-two.vercel.app",
    ];
    if (origin && !(allowedOrigins.includes(origin) || origin.includes("vercel.app"))) {
      fastify.log.warn({ origin }, "❌ WS origin no permitido, cerrando conexión.");
      try { connection.socket.send(JSON.stringify({ type: "error", error: "origin_not_allowed" })); } catch {}
      connection.socket.close();
      return;
    }

    if (!chatId) {
      connection.socket.send("❌ chatId requerido en la conexión");
      connection.socket.close();
      return;
    }

    if (!chatRooms.has(chatId)) {
      chatRooms.set(chatId, new Set());
    }
    chatRooms.get(chatId).add(connection.socket);

    socketState.set(connection.socket, {
      chatId,
      anonToken: anonToken || undefined,
      lastPongAt: Date.now(),
      messagesCount: 0,
      createdAt: Date.now(),
      closed: false,
    });

    fastify.log.info(`🔌 Cliente conectado chat=${chatId} ip=${ip} anonToken=${anonToken || "none"}`);

    connection.socket.send(JSON.stringify({
      type: "welcome",
      chatId,
      anonToken: anonToken || null,
      serverTime: new Date().toISOString(),
      msg: "WS conectado",
    }));

    // Ping/Pong keep-alive (Railway corta inactivos)
    const PING_INTERVAL_MS = 25_000;
    const PONG_TIMEOUT_MS = 60_000;
    const pingTimer = setInterval(() => {
      const st = socketState.get(connection.socket);
      if (!st || st.closed) return;

      if (Date.now() - st.lastPongAt > PONG_TIMEOUT_MS) {
        fastify.log.warn(`⏱️ WS sin pong, cerrando chat=${chatId}`);
        try { connection.socket.close(); } catch {}
        clearInterval(pingTimer);
        return;
      }

      try { connection.socket.ping?.(); } catch {}
      try { connection.socket.send(JSON.stringify({ type: "ping", t: Date.now() })); } catch {}
    }, PING_INTERVAL_MS);

    connection.socket.on("pong", () => {
      const st = socketState.get(connection.socket);
      if (st) st.lastPongAt = Date.now();
    });

    connection.socket.on("message", (raw) => {
      let parsed;
      try { parsed = JSON.parse(raw.toString()); }
      catch { parsed = { content: raw.toString() }; }

      const MAX_LEN = 4000;
      const safeContent =
        typeof parsed.content === "string"
          ? parsed.content.slice(0, MAX_LEN)
          : String(parsed.content ?? "").slice(0, MAX_LEN);

      const payload = {
        type: "message",
        chatId,
        from: parsed.from || (anonToken ? "anon" : "creator"),
        alias: parsed.alias || "Anónimo",
        content: safeContent,
        createdAt: new Date(),
      };

      const st = socketState.get(connection.socket);
      if (st) {
        st.messagesCount++;
        if (st.messagesCount % 200 === 0) {
          fastify.log.warn(`⚠️ Flood posible en chat=${chatId} msgs=${st.messagesCount}`);
        }
      }

      fastify.log.info(`📩 [${chatId}] ${safeContent}`);

      const clients = chatRooms.get(chatId) || new Set();
      for (const client of clients) {
        try {
          if (client.readyState === 1) {
            client.send(JSON.stringify(payload));
          }
        } catch {}
      }
    });

    connection.socket.on("close", () => {
      const st = socketState.get(connection.socket);
      if (st) st.closed = true;
      fastify.log.info(`❌ Cliente salió chat=${chatId}`);
      chatRooms.get(chatId)?.delete(connection.socket);
      if ((chatRooms.get(chatId)?.size || 0) === 0) {
        chatRooms.delete(chatId);
      }
      clearInterval(pingTimer);
    });

    connection.socket.on("error", (err) => {
      fastify.log.error(`⚠️ Error WS chat=${chatId}:`, err);
    });

  } catch (err) {
    fastify.log.error("❌ Error inicializando WebSocket:", err);
    try { connection.socket.close(); } catch {}
  }
});

/* ======================
   Plugins personalizados
   ====================== */
fastify.register(authPlugin);

/* ======================
   Rutas REST
   ====================== */
fastify.register(creatorsRoutes);
fastify.register(chatsRoutes);
fastify.register(messagesRoutes);
fastify.register(publicRoutes);
fastify.register(dashboardChats);
fastify.register(subscribe);
fastify.register(require("./routes/premiumDummy")); // solo en dev

/* ======================
   Healthcheck y Debug
   ====================== */
fastify.get("/", async () => ({ status: "API ok" }));

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

/* ======================
   Apagado elegante
   ====================== */
const shutdown = async (signal) => {
  try {
    fastify.log.warn(`Recibida señal ${signal}, cerrando WS y servidor...`);
    for (const [, set] of chatRooms.entries()) {
      for (const sock of set.values()) {
        try { sock.close(); } catch {}
      }
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

/* ======================
   Start
   ====================== */
const start = async () => {
  try {
    const port = process.env.PORT || 8080;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`🚀 Servidor corriendo en puerto ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
