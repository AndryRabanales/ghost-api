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
// ⚠️ trustProxy habilitado: Railway usa proxy y manda x-forwarded-*
// ======================
const fastify = Fastify({
  logger: true,
  trustProxy: true,
});

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

/* ======================
   Hooks globales (Railway + WS)
   - Reafirma el upgrade para proxies
   - Añade no-cache y keep-alive
   ====================== */
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
  

/* ======================
   WebSocket
   - Ojo: perMessageDeflate desactivado; a veces rompe con proxies
   ====================== */
fastify.register(websocket, {
  options: {
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024, // 1 MB por si acaso
  },
});

const chatRooms = new Map();
const socketState = new WeakMap();

/* ======================
   Ruta WebSocket con soporte de rooms
   ====================== */
// Obtener parámetros
const chatId = url.searchParams.get("chatId") || "default";

// Confirmación inicial
fastify.log.info(`✅ Cliente WS conectado en chat=${chatId}`);
connection.socket.send(JSON.stringify({
  type: "welcome",
  chatId,
  msg: "Conexión WebSocket establecida 🚀"
}));

// Manejar mensajes entrantes
connection.socket.on("message", (msg) => {
  fastify.log.info(`📩 Mensaje recibido en ${chatId}: ${msg}`);
  connection.socket.send(`Echo: ${msg}`); // responder
});

// Manejar cierre
connection.socket.on("close", () => {
  fastify.log.info(`❌ Cliente desconectado de chat=${chatId}`);
});

    

    const chatId = url.searchParams.get("chatId");
    const anonToken = url.searchParams.get("anonToken") || null;

    // Origen & Proto (útiles detrás de proxy)
    const origin = req.headers.origin || "";
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    const proto = req.headers["x-forwarded-proto"] || (req.protocol || "http");

    // 🧰 Aviso suave si no viene HTTPS en proxy (solo log)
    if (proto !== "https") {
      fastify.log.warn({ proto }, "⚠️ x-forwarded-proto no es https (proxy podría no estar en TLS)");
    }

    // ✅ Validación suave de Origin (mismo allowlist que CORS)
    const allowedOrigins = [
      "http://localhost:3000",
      "https://ghost-web-two.vercel.app",
    ];
    if (
      origin &&
      !(allowedOrigins.includes(origin) || (typeof origin === "string" && origin.includes("vercel.app")))
    ) {
      fastify.log.warn({ origin }, "❌ WS origin no permitido, cerrando conexión.");
      try { connection.socket.send(JSON.stringify({ type: "error", error: "origin_not_allowed" })); } catch {}
      try { connection.socket.close(); } catch {}
      return;
    }

    if (!chatId) {
      try { connection.socket.send("❌ chatId requerido en la conexión"); } catch {}
      try { connection.socket.close(); } catch {}
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

    fastify.log.info(`🔌 Cliente conectado chat=${chatId} ip=${ip} proto=${proto} origin=${origin || "none"} anon=${anonToken || "none"}`);

    // Mensaje de bienvenida/diagnóstico
    try {
      connection.socket.send(
        JSON.stringify({
          type: "welcome",
          chatId,
          anonToken: anonToken || null,
          serverTime: new Date().toISOString(),
          msg: "WS conectado",
        })
      );
    } catch (e) {
      fastify.log.warn({ err: e }, "No se pudo enviar mensaje de welcome");
    }

    // 🫀 Ping/Pong keep-alive (Railway corta inactivos)
    const PING_INTERVAL_MS = 25_000;
    const PONG_TIMEOUT_MS = 60_000;
    const pingTimer = setInterval(() => {
      const st = socketState.get(connection.socket);
      if (!st || st.closed) return;

      // cerrar si pasó demasiado sin pong
      if (Date.now() - st.lastPongAt > PONG_TIMEOUT_MS) {
        fastify.log.warn(`⏱️ WS sin pong, cerrando chat=${chatId}`);
        try { connection.socket.close(); } catch {}
        clearInterval(pingTimer);
        return;
      }

      // Intento nativo (si lo soporta)
      try { connection.socket.ping?.(); } catch {}
      // Fallback ping app-level
      try { connection.socket.send(JSON.stringify({ type: "ping", t: Date.now() })); } catch {}
    }, PING_INTERVAL_MS);

    // 🔁 Si la lib expone "pong"
    connection.socket.on?.("pong", () => {
      const st = socketState.get(connection.socket);
      if (st) st.lastPongAt = Date.now();
    });

    // 👇 Manejo de mensajes con JSON seguro
    connection.socket.on("message", (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        parsed = { content: raw.toString() };
      }

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
        } catch (e) {
          fastify.log.warn({ err: e }, "No se pudo emitir a un cliente");
        }
      }
    });

    // ✅ Manejo de desconexión
    connection.socket.on("close", () => {
      const st = socketState.get(connection.socket);
      if (st) st.closed = true;

      fastify.log.info(`❌ Cliente salió chat=${chatId}`);
      try {
        chatRooms.get(chatId)?.delete(connection.socket);
        if ((chatRooms.get(chatId)?.size || 0) === 0) {
          chatRooms.delete(chatId);
        }
      } catch {}
      clearInterval(pingTimer);
    });

    // ✅ Manejo de errores
    connection.socket.on("error", (err) => {
      fastify.log.error({ err }, `⚠️ Error WS chat=${chatId}`);
    });

  } catch (err) {
    // 👇 Este catch capturaba tu "❌ Error inicializando WebSocket:"
    // Ahora loguea más contexto y no deja el proceso inestable
    fastify.log.error({ err }, "❌ Error inicializando WebSocket");
    try { connection.socket.send(JSON.stringify({ type: "error", error: "init_failed" })); } catch {}
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
   Healthcheck y Debug extra
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

fastify.get("/_debug/headers", async (req) => {
  // Ver headers que llegan tras el proxy
  return {
    url: req.url,
    method: req.method,
    headers: req.headers,
    ip: req.headers["x-forwarded-for"] || req.ip,
    proto: req.headers["x-forwarded-proto"] || (req.protocol || "http"),
  };
});

fastify.get("/_debug/env", async () => {
  // Algunas vars útiles (no exponemos todo)
  return {
    node_env: process.env.NODE_ENV || null,
    port: process.env.PORT || null,
    internal_broadcast_key: !!process.env.INTERNAL_BROADCAST_KEY,
  };
});

fastify.get("/healthz", async () => ({ ok: true, ts: Date.now() }));
fastify.get("/.well-known/health", async () => ({ status: "ok", ts: Date.now() }));

/* ======================
   Endpoint de broadcast interno (simple, con clave opcional)
   ====================== */
fastify.post("/_internal/broadcast", async (req, reply) => {
  const key = req.headers["x-internal-key"];
  const expected = process.env.INTERNAL_BROADCAST_KEY || null;
  if (expected && key !== expected) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  const { chatId, content, from, alias } = req.body || {};
  if (!chatId || !content) {
    return reply.code(400).send({ error: "chatId y content son requeridos" });
  }
  const payload = {
    type: "message",
    chatId,
    from: from || "system",
    alias: alias || "Sistema",
    content: String(content).slice(0, 4000),
    createdAt: new Date(),
  };
  const clients = chatRooms.get(chatId) || new Set();
  let delivered = 0;
  for (const client of clients) {
    try {
      if (client.readyState === 1) {
        client.send(JSON.stringify(payload));
        delivered++;
      }
    } catch {}
  }
  return { ok: true, delivered };
});

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
};8
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* ======================
   Start
   ====================== */
const start = async () => {
  try {
    const port = process.env.PORT || 8080; // Railway asigna PORT automáticamente
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`🚀 Servidor corriendo en puerto ${port}`);
    // Pequeño log útil en producción
    fastify.log.info("✅ Fastify listo. Prueba WS en: wss://<tu-dominio>/ws/chat?chatId=test");
  } catch (err) {
    fastify.log.error(err);
    // No hacemos process.exit inmediato en prod para evitar crash loops
    process.exit(1);
  }
};
start();
