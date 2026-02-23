// server.js
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const websocket = require("@fastify/websocket");

// --- IMPORTAR RUTAS Y PLUGINS ---
const authPlugin = require("./plugins/auth");
const websocketPlugin = require("./plugins/websocket");
const authRoutes = require("./routes/auth");
const creatorsRoutes = require("./routes/creators");
const chatsRoutes = require("./routes/chats");
const messagesRoutes = require("./routes/messages");
const publicRoutes = require("./routes/public");
const dashboardChats = require("./routes/dashboardChats");

const adminAuthPlugin = require("./plugins/adminAuth");
const adminRoutes = require("./routes/admin");

const fastify = Fastify({
  logger: true,
  trustProxy: true,
  // --- 👇 2. AÑADIR CONFIGURACIÓN PARA RAW BODY ---
  // (Necesario para que el webhook de Stripe pueda leer la firma)
  pluginTimeout: 20000, // Extender timeout por si acaso
  bodyLimit: 1048576 * 10, // Aumentar límite si es necesario
});

// Configurar Fastify para que NO parsee el body en la ruta del webhook
// Esto debe ir ANTES de registrar las rutas.
fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (req, body, done) => {
    try {
      if (req.routeOptions.config?.rawBody) {
        // Si la ruta pide rawBody, se lo pasamos
        req.rawBody = body;
      }
      // Parseamos como JSON para todas las demás rutas
      const json = JSON.parse(body);
      done(null, json);
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  }
);
// --- FIN CONFIGURACIÓN RAW BODY ---


// --- CONFIGURACIÓN DE CORS (Sin cambios) ---
fastify.register(cors, {
  origin: [
    'http://localhost:3000',
    'https://ghostmsg.space',
    'https://www.ghostmsg.space'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// --- PLUGINS (Sin cambios) ---
fastify.register(authPlugin);
fastify.register(websocket);
fastify.register(websocketPlugin);
fastify.register(adminAuthPlugin);

// --- REGISTRAR TODAS LAS RUTAS ---
fastify.register(authRoutes);
fastify.register(creatorsRoutes);
fastify.register(chatsRoutes);
fastify.register(messagesRoutes);
fastify.register(publicRoutes);
fastify.register(dashboardChats);
fastify.register(adminRoutes);
// --- FIN REGISTRO ---

// --- INICIAR EL SERVIDOR (Sin cambios) ---
const start = async () => {
  try {
    const port = process.env.PORT || 8080;
    await fastify.listen({
      port: port,
      host: '0.0.0.0'
    });
    fastify.log.info(`Servidor escuchando en el puerto: ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();