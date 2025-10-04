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
const premiumDummyRoutes = require("./routes/premiumDummy"); // Asegúrate de incluir esta ruta si la usas

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
    // Orígenes permitidos para tu frontend
    const allowedOrigins = [
      "http://localhost:3000",
      "https://ghost-web-two.vercel.app",
    ];
    // Permite solicitudes sin origen (como las de Postman) y las de dominios permitidos/subdominios de vercel
    if (!origin || allowedOrigins.includes(origin) || (typeof origin === "string" && origin.includes("vercel.app"))) {
      cb(null, true);
      return;
    }
    cb(new Error("Origen no permitido por CORS"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Límite de peticiones para prevenir ataques de fuerza bruta
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

// --- Estructuras en memoria para manejar el estado del chat ---

// Almacena las salas de chat activas. La clave es el `chatId` y el valor es un Set de sockets de cliente.
// Usar un Map para las salas permite un acceso y borrado rápido (O(1) en promedio).
// Usar un Set para los clientes previene duplicados y permite agregar/quitar clientes eficientemente.
const chatRooms = new Map(); // Map<chatId, Set<WebSocket>>

// Almacena metadatos para cada socket conectado. Usamos WeakMap para que el estado
// se elimine automáticamente si el socket es recolectado por el garbage collector,
// previniendo fugas de memoria.
const socketState = new WeakMap(); // WeakMap<WebSocket, {chatId, anonToken, ...}>

// Guarda un historial de los últimos mensajes por sala para enviarlo a nuevos clientes.
const chatHistory = new Map(); // Map<chatId, Array<MessagePayload>>

// --- Funciones auxiliares de WebSocket ---

/**
 * Genera un token anónimo único para un nuevo cliente de chat.
 * @returns {string} Un token hexadecimal.
 */
const generateAnonToken = () => crypto.randomBytes(8).toString("hex");

/**
 * Envía un mensaje a todos los clientes en una sala de chat específica.
 * También guarda el mensaje en el historial de la sala.
 * @param {string} chatId - El ID de la sala de chat.
 * @param {object} payload - El objeto del mensaje a enviar.
 */
const broadcastMessage = (chatId, payload) => {
  const room = chatRooms.get(chatId);
  if (!room) return;

  // Enviar el mensaje a cada cliente en la sala
  for (const client of room) {
    try {
      // Solo enviar si el cliente está en estado OPEN (listo para recibir)
      if (client.readyState === 1) {
        client.send(JSON.stringify(payload));
      }
    } catch (err) {
      fastify.log.error(`Error enviando mensaje a un cliente en la sala ${chatId}:`, err);
    }
  }

  // Guardar en el historial de la sala
  if (!chatHistory.has(chatId)) {
    chatHistory.set(chatId, []);
  }
  const history = chatHistory.get(chatId);
  history.push(payload);
  // Mantener solo los últimos 100 mensajes para no consumir demasiada memoria
  if (history.length > 100) {
    history.shift();
  }
};


/**
 * Ruta principal para la conexión WebSocket.
 * Maneja el ciclo de vida completo de una conexión de cliente.
 */
// ... todo tu código anterior a la ruta /ws/chat ...

/**
 * Ruta principal para la conexión WebSocket.
 * Maneja el ciclo de vida completo de una conexión de cliente.
 */
fastify.get("/ws/chat", { websocket: true }, (connection, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatId = url.searchParams.get("chatId") || "default";
    const anonToken = url.searchParams.get("anonToken") || generateAnonToken();
    const origin = req.headers.origin || "";
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";

    // 1. Validación de Origen (Seguridad)
    const allowedOrigins = ["http://localhost:3000", "https://ghost-web-two.vercel.app"];
    // Permitimos explícitamente el origen vacío para pruebas locales con herramientas que no envían la cabecera.
    // En producción, podrías querer quitar `origin === ""` de la condición.
    if (!allowedOrigins.includes(origin) && origin !== "") {
      fastify.log.warn(`Conexión WS rechazada de origen no permitido: ${origin}`);
      connection.socket.send(JSON.stringify({ type: "error", error: "origin_not_allowed" }));
      connection.socket.close();
      return;
    }

    // 2. Unir al cliente a la sala de chat
    if (!chatRooms.has(chatId)) {
      chatRooms.set(chatId, new Set());
    }
    const room = chatRooms.get(chatId);
    room.add(connection.socket);

    // 3. Guardar el estado inicial del socket
    socketState.set(connection.socket, {
      chatId,
      anonToken,
      messagesCount: 0,
      createdAt: Date.now(),
      lastPongAt: Date.now(),
      closed: false,
    });

    fastify.log.info(`🔌 Cliente conectado: chatId=${chatId}, anonToken=${anonToken}, ip=${ip}, origin=${origin || "ninguno"}`);

    // 4. Enviar historial de chat al nuevo cliente
    if (chatHistory.has(chatId)) {
      connection.socket.send(JSON.stringify({ type: "history", messages: chatHistory.get(chatId) }));
    }

    // 5. Enviar mensaje de bienvenida
    connection.socket.send(JSON.stringify({
      type: "welcome",
      chatId,
      anonToken,
      serverTime: new Date().toISOString(),
      message: "Conexión WebSocket establecida con éxito 🚀",
    }));

    // 6. Sistema de Ping/Pong para mantener la conexión activa (Keep-alive)
    const pingInterval = setInterval(() => {
      const state = socketState.get(connection.socket);
      if (state && !state.closed) {
        if (Date.now() - state.lastPongAt > 60000) {
          fastify.log.warn(`Cliente sin respuesta al ping, terminando conexión: chatId=${chatId}`);
          clearInterval(pingInterval);
          return connection.socket.terminate();
        }
        connection.socket.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
    
    connection.socket.on("pong", () => {
      const state = socketState.get(connection.socket);
      if (state) {
        state.lastPongAt = Date.now();
      }
    });

    // 7. Manejo de mensajes entrantes del cliente
    connection.socket.on("message", (rawMessage) => {
      const state = socketState.get(connection.socket);
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

    // 8. Limpieza al cerrar la conexión
    const cleanup = () => {
      const state = socketState.get(connection.socket);
      if (state && !state.closed) {
        state.closed = true;
        const room = chatRooms.get(chatId);
        if (room) {
          room.delete(connection.socket);
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
    
    connection.socket.on("close", cleanup);
    connection.socket.on("error", (err) => {
      fastify.log.error({ err }, `⚠️ Error en conexión WS, cerrando: chatId=${chatId}`);
      cleanup();
    });

  } catch (err) {
    fastify.log.error({ err }, "❌ Error fatal al inicializar WebSocket");
    
    // ----- INICIO DE LA CORRECCIÓN -----
    // En este punto, el estado de 'connection' es incierto.
    // Es más seguro simplemente intentar cerrar la conexión si existe,
    // sin intentar enviar un mensaje que podría fallar.
    if (connection && connection.socket) {
      try {
        // Cierra con un código de error estándar para "condición inesperada"
        connection.socket.close(1011, "Internal server error");
      } catch (closeErr) {
        // Si incluso cerrar falla, lo registramos pero evitamos que el programa crashee.
        fastify.log.error({ closeErr }, "Error adicional al intentar cerrar el socket fallido.");
      }
    }
    // ----- FIN DE LA CORRECCIÓN -----
  }
});

// ... el resto de tu server.js ...


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

// Endpoint para depurar el estado de las salas de chat en tiempo real
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
  
  // Cerrar todas las conexiones WebSocket activas
  fastify.log.info("Cerrando todas las conexiones WebSocket...");
  for (const client of fastify.websocketServer.clients) {
    client.close(1012, "Servidor reiniciando"); // 1012: Service Restart
  }

  // Cerrar el servidor Fastify
  await fastify.close();
  
  fastify.log.info("✅ Servidor cerrado correctamente. Adiós.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT")); // Captura Ctrl+C
process.on("SIGTERM", () => shutdown("SIGTERM")); // Captura señales de terminación (ej. de Docker, Render)


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