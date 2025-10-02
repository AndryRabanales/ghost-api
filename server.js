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
   
   // ✅ Ruta WebSocket con soporte de rooms por chatId
   fastify.get("/ws/chat", { websocket: true }, (connection, req) => {
     try {
       // Forzar keep-alive para Render
       req.socket.setKeepAlive(true);
   
       const url = new URL(req.url, `http://${req.headers.host}`);
       const chatId = url.searchParams.get("chatId");
   
       if (!chatId) {
         connection.socket.send("❌ chatId requerido en la conexión");
         connection.socket.close();
         return;
       }
   
       if (!chatRooms.has(chatId)) {
         chatRooms.set(chatId, new Set());
       }
       chatRooms.get(chatId).add(connection.socket);
   
       fastify.log.info(`🔌 Cliente conectado al chat ${chatId}`);
   
       // 👇 Manejo de mensajes con JSON seguro
       connection.socket.on("message", (raw) => {
         let parsed;
         try {
           parsed = JSON.parse(raw.toString());
         } catch {
           parsed = { content: raw.toString() };
         }
   
         const payload = {
           chatId,
           from: parsed.from || "anon",
           alias: parsed.alias || "Anónimo",
           content: parsed.content,
           createdAt: new Date(),
         };
   
         fastify.log.info(`📩 Mensaje en [${chatId}]: ${JSON.stringify(payload)}`);
   
         for (const client of chatRooms.get(chatId)) {
           if (client.readyState === 1) {
             client.send(JSON.stringify(payload));
           }
         }
       });
   
       // ✅ Manejo de desconexión
       connection.socket.on("close", () => {
         fastify.log.info(`❌ Cliente salió del chat ${chatId}`);
         chatRooms.get(chatId).delete(connection.socket);
         if (chatRooms.get(chatId).size === 0) {
           chatRooms.delete(chatId);
         }
       });
   
       // ✅ Manejo de errores
       connection.socket.on("error", (err) => {
         fastify.log.error(`⚠️ Error WS en chat ${chatId}:`, err);
       });
   
     } catch (err) {
       fastify.log.error("❌ Error inicializando WebSocket:", err);
       connection.socket.close();
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
