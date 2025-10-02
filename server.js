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
fastify.register(cors, (instance) => {
  return (req, cb) => {
    const allowedOrigins = [
      "http://localhost:3000",              // Frontend local
      "https://ghost-web-two.vercel.app",   // Frontend en Vercel
    ];

  

    const origin = req.headers.origin;

    // ✅ Rutas públicas aceptan todos los orígenes
    if (req.url.startsWith("/public")) {
      cb(null, {
        origin: true,
        methods: ["GET", "POST", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
      });
      return;
    }

    
    

    // ✅ Rutas privadas aceptan solo los dominios permitidos
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, {
        origin: true,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
      });
    } else {
      cb(new Error("Not allowed by CORS"), false);
    }
  };
});

fastify.options("/*", (req, reply) => {
  reply
    .header("Access-Control-Allow-Origin", "*")
    .header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    .header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    .code(204)
    .send();
});


// Rate Limit → limita peticiones por minuto para evitar abusos
fastify.register(rateLimit, { max: 60, timeWindow: "1 minute" });

/* ======================
   WebSocket
   ====================== */
fastify.register(websocket);

// Mapa de rooms para agrupar sockets por chatId
const chatRooms = new Map();

// Ruta de ejemplo WebSocket (se mantiene igual para compatibilidad)
fastify.get("/ws", { websocket: true }, (connection, req) => {
  connection.socket.on("message", (message) => {
    fastify.log.info(`📩 Mensaje recibido: ${message}`);

    // Responder solo a este cliente
    connection.socket.send(`Echo: ${message}`);

    // 🔄 Broadcast a todos los clientes conectados (global)
    fastify.websocketServer.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message.toString());
      }
    });
  });
});

// Nueva ruta WebSocket con soporte de rooms por chatId
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

  // Manejar mensajes dentro del room
  connection.socket.on("message", (message) => {
    fastify.log.info(`📩 [${chatId}] ${message}`);
    for (const client of chatRooms.get(chatId)) {
      if (client.readyState === 1) {
        client.send(message.toString());
      }
    }
  });

  // Al desconectarse, limpiar del room
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
