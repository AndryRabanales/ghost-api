// server.js - Versión Final con Simulador y Verificador
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
const premiumPayments = require("./routes/premiumPayments");
const premiumWebhook = require("./routes/premiumWebhook");

// --- NUEVO ---
const adminAuthPlugin = require("./plugins/adminAuth");
const adminRoutes = require("./routes/admin");
// --- FIN NUEVO ---

const fastify = Fastify({ logger: true, trustProxy: true });

// --- CONFIGURACIÓN ---
// --- CONFIGURACIÓN DE SEGURIDAD (CORS) ---
// En lugar de aceptar cualquier origen, solo aceptamos el de nuestro frontend.
// --- CONFIGURACIÓN DE SEGURIDAD (CORS) ---
// Aceptamos ambos orígenes del frontend: con 'www' y sin 'www'.
fastify.register(cors, { 
    origin: [
      'https://ghostmsg.space', 
      'https://www.ghostmsg.space'
    ], 
    methods: ['GET', 'POST', 'PUT', 'DELETE'] // Métodos que permitimos
  });
// --- PLUGINS ---
fastify.register(authPlugin);
fastify.register(websocket);
fastify.register(websocketPlugin);

// --- NUEVO ---
fastify.register(adminAuthPlugin);
// --- FIN NUEVO ---


// --- REGISTRAR TODAS LAS RUTAS ---
// El archivo testSimulator.js ya contiene AMBAS rutas (/simulate y /verify-status)
// por lo que al registrarlo aquí, ambas estarán disponibles.
fastify.register(authRoutes);
fastify.register(creatorsRoutes);
fastify.register(chatsRoutes);
fastify.register(messagesRoutes);
fastify.register(publicRoutes);
fastify.register(dashboardChats);
fastify.register(premiumPayments);
fastify.register(premiumWebhook);

// --- NUEVO ---
fastify.register(adminRoutes);
// --- FIN NUEVO ---

// --- INICIAR EL SERVIDOR ---
const start = async () => {
  try {
    const port = process.env.PORT || 8080;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`Servidor escuchando en el puerto ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();