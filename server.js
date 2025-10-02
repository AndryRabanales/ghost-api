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
fastify.register(websocket);

// Mapa de rooms para agrupar sockets por chatId
const chatRooms = new Map();

// Ruta WebSocket con soporte de rooms por chatId (fusionada)
fastify.get("/ws/chat", { websocket: true }, (connection, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chatId = url.searchParams.get("chatId");

  if (!chatId) {
    connection.socket.send("❌ chatId requerido en la conexión");
    connection.socket.close();
    return;
  }

  // Agregar socket al room correspondiente
  if (!chatRooms.has(chatId)) {
    chatRooms.set(chatId, new Set());
  }
  chatRooms.get(chatId).add(connection.socket);

  fastify.log.info(`🔌 Cliente conectado al chat ${chatId}`);

  // 👇 Manejo de mensajes con JSON
  connection.socket.on("message", (raw) => {
    fastify.log.info(`📩 [${chatId}] ${raw}`);

    let parsed;
    try {
      parsed = JSON.parse(raw.toString()); // intentar parsear JSON
    } catch {
      parsed = { content: raw.toString() }; // fallback si no es JSON
    }

    const payload = {
      chatId,
      from: parsed.from || "anon",
      alias: parsed.alias || "Anónimo",
      content: parsed.content,
      createdAt: new Date(),
    };

    for (const client of chatRooms.get(chatId)) {
      if (client.readyState === 1) {
        client.send(JSON.stringify(payload)); // enviar como JSON
      }
    }
  });

  // 🔻 Limpieza de conexiones al cerrar
  connection.socket.on("close", () => {
    fastify.log.info(`❌ Cliente salió del chat ${chatId}`);
    chatRooms.get(chatId).delete(connection.socket);
    if (chatRooms.get(chatId).size === 0) {
      chatRooms.delete(chatId);
    }
  });
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

/* ======================
   Start (levantar servidor)
   ====================== */
const start = async () => {
  try {
    await fastify.listen({
      port: process.env.PORT || 3001,
      host: "0.0.0.0",
    });
    fastify.log.info(
      `🚀 Servidor corriendo en puerto ${process.env.PORT || 3001}`
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
