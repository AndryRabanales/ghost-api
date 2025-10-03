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

// Helmet → añade cabeceras de seguridad HTTP
fastify.register(helmet);

// CORS → controla qué orígenes pueden acceder a la API
fastify.register(cors, {
  origin: (origin, cb) => {
    const allowedOrigins = [
      "http://localhost:3000",
      "https://ghost-web-two.vercel.app",
    ];
    if (!origin || allowedOrigins.includes(origin) || origin.includes("vercel.app")) {
      cb(null, true); // ✅ permitido
      return;
    }
    cb(new Error("Not allowed"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Rate Limit → limita peticiones por minuto para evitar abusos
fastify.register(rateLimit, { max: 60, timeWindow: "1 minute" });

/* ======================
   WebSocket
   ====================== */
/* ======================
   WebSocket
   ====================== */
fastify.register(websocket);

// Mapa de rooms para agrupar sockets por chatId
const chatRooms = new Map();

// 💡 Mapa auxiliar: seguimiento de estado por socket (para ping/pong, cuota, etc.)
const socketState = new WeakMap();

// ✅ Ruta WebSocket con soporte de rooms por chatId
fastify.get("/ws/chat", { websocket: true }, (connection, req) => {
  try {
    // Forzar keep-alive (Railway/Node)
    req.socket.setKeepAlive(true);

    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatId = url.searchParams.get("chatId");
    const anonToken = url.searchParams.get("anonToken") || null; // 🔎 lectura opcional
    const origin = req.headers.origin || "";

    // ✅ (Extra) Validación suave de Origin para WS (mismo allowlist que CORS)
    const allowedOrigins = [
      "http://localhost:3000",
      "https://ghost-web-two.vercel.app",
    ];
    if (origin && !(allowedOrigins.includes(origin) || origin.includes("vercel.app"))) {
      fastify.log.warn({ origin }, "WS origin no permitido, cerrando conexión.");
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

    // Estado por-socket
    socketState.set(connection.socket, {
      chatId,
      anonToken: anonToken || undefined,
      lastPongAt: Date.now(),
      messagesCount: 0,
      createdAt: Date.now(),
      closed: false,
    });

    fastify.log.info(
      `🔌 Cliente conectado al chat ${chatId} (anonToken: ${anonToken || "no enviado"})`
    );

    // 👋 Mensaje de bienvenida (útil para debug de cliente)
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
      fastify.log.warn("No se pudo enviar welcome:", e);
    }

    // 🫀 Ping/Pong keep-alive (Railway cierra conexiones inactivas)
    // - Enviamos ping cada 25s. Si no llega pong en 60s, cerramos.
    const PING_INTERVAL_MS = 25_000;
    const PONG_TIMEOUT_MS = 60_000;
    const pingTimer = setInterval(() => {
      const st = socketState.get(connection.socket);
      if (!st || st.closed) return;

      // cerrar si pasó demasiado sin pong
      if (Date.now() - st.lastPongAt > PONG_TIMEOUT_MS) {
        fastify.log.warn(`WS sin pong, cerrando chat=${chatId}`);
        try { connection.socket.close(); } catch {}
        clearInterval(pingTimer);
        return;
      }

      try { connection.socket.ping?.(); } catch { /* ws en fastify usa .socket, ping opcional */ }
      // fallback: enviar un ping estilo app:
      try { connection.socket.send(JSON.stringify({ type: "ping", t: Date.now() })); } catch {}
    }, PING_INTERVAL_MS);

    // Escuchar pong (si el driver lo expone)
    connection.socket.on("pong", () => {
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

      // Saneo/safety: limitar tamaño de mensaje
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

      // Pequeña cuota por socket para evitar flood (200 msg/min/socket)
      const st = socketState.get(connection.socket);
      if (st) {
        st.messagesCount++;
        if (st.messagesCount % 200 === 0) {
          fastify.log.warn(`WS cuota alta en chat=${chatId} count=${st.messagesCount}`);
        }
      }

      fastify.log.info(`📩 Mensaje en [${chatId}]: ${JSON.stringify(payload)}`);

      // Broadcast en el room
      const clients = chatRooms.get(chatId) || new Set();
      for (const client of clients) {
        try {
          if (client.readyState === 1) {
            client.send(JSON.stringify(payload));
          }
        } catch (e) {
          fastify.log.warn("No se pudo emitir a un cliente:", e);
        }
      }
    });

    // ✅ Manejo de desconexión
    connection.socket.on("close", () => {
      const st = socketState.get(connection.socket);
      if (st) st.closed = true;

      fastify.log.info(`❌ Cliente salió del chat ${chatId}`);
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
      fastify.log.error(`⚠️ Error WS en chat ${chatId}:`, err);
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
   Healthcheck (para probar que el server corre)
   ====================== */
fastify.get("/", async () => ({ status: "API ok" }));

/* ========================================================
   🔎 Rutas utilitarias de depuración/observabilidad (nuevas)
   - NO quitan nada, solo agregan info útil para monitoreo
   ======================================================== */

// Listar rooms y tamaños
fastify.get("/_debug/ws/rooms", async () => {
  const out = [];
  for (const [roomId, set] of chatRooms.entries()) {
    out.push({ roomId, clients: set.size });
  }
  return { rooms: out, totalRooms: out.length };
});

// Resumen de sockets vivos
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

// Endpoint de broadcast interno (simple, con clave opcional)
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

// Endpoint de “ping” HTTP para uptime
fastify.get("/healthz", async () => ({ ok: true, ts: Date.now() }));
fastify.get("/.well-known/health", async () => ({ status: "ok", ts: Date.now() }));

/* ======================
   Apagado elegante (graceful shutdown)
   ====================== */
const shutdown = async (signal) => {
  try {
    fastify.log.warn(`Recibida señal ${signal}, cerrando WS y servidor...`);
    // Cerrar todos los sockets
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
   Start (levantar servidor)
   ====================== */
const start = async () => {
  try {
    const port = process.env.PORT || 8080; // 👈 Railway asigna PORT automáticamente
    await fastify.listen({
      port,
      host: "0.0.0.0",
    });
    fastify.log.info(`🚀 Servidor corriendo en puerto ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
