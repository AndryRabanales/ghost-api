// plugins/websocket.js
const fp = require('fastify-plugin');
const { PrismaClient } = require('@prisma/client'); // 👈 1. IMPORTAR
const jwt = require('jsonwebtoken'); // 👈 2. IMPORTAR
const prisma = new PrismaClient(); // 👈 3. INICIAR PRISMA

async function websocketPlugin(fastify, options) {
  
  const chatRooms = new Map();
  const dashboardRooms = new Map();

  // ... (tus funciones broadcastToChat y broadcastToDashboard se quedan igual)
  function broadcastToChat(chatId, payload) {
    // ... (sin cambios)
  }
  function broadcastToDashboard(creatorId, payload) {
    // ... (sin cambios)
  }

  fastify.decorate('broadcastToChat', broadcastToChat);
  fastify.decorate('broadcastToDashboard', broadcastToDashboard);

  fastify.addHook('onReady', () => {
    fastify.log.info('Plugin de WebSocket listo. Adjuntando listener de conexión global...');

    // 👇 4. HACER QUE EL LISTENER SEA ASÍNCRONO
    fastify.websocketServer.on('connection', async (socket, req) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const chatId = url.searchParams.get("chatId");
        const dashboardId = url.searchParams.get("dashboardId");
        
        // --- LÓGICA DE AUTENTICACIÓN DE WEBSOCKET ---
        if (dashboardId) {
          const token = url.searchParams.get("token"); // Token JWT
          if (!token) {
            return socket.close(1008, "Token no proporcionado");
          }
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.id !== dashboardId) {
              return socket.close(1008, "Token no válido para este dashboard");
            }
            // Autenticado
            fastify.log.info(`🔌 ¡Conexión WS de Dashboard exitosa! Cliente conectado a: ${dashboardId}`);
            
            if (!dashboardRooms.has(dashboardId)) {
                dashboardRooms.set(dashboardId, new Set());
            }
            const room = dashboardRooms.get(dashboardId);
            room.add(socket);

            socket.send(JSON.stringify({ type: "welcome", message: `Conectado al dashboard ${dashboardId}` }));

            socket.on('close', () => {
                fastify.log.info(`❌ Cliente desconectado de la sala de dashboard: ${dashboardId}`);
                room.delete(socket);
                if (room.size === 0) {
                    dashboardRooms.delete(dashboardId);
                }
            });

          } catch (jwtError) {
            fastify.log.warn(`Token JWT inválido: ${jwtError.message}. Cerrando.`);
            return socket.close(1008, "Token inválido");
          }
        
        } else if (chatId) {
          const anonToken = url.searchParams.get("anonToken");
          if (!anonToken) {
            return socket.close(1008, "Token de chat no proporcionado");
          }

          // Validar contra la BD
          const chat = await prisma.chat.findFirst({
            where: { id: chatId, anonToken: anonToken }
          });

          if (!chat) {
            return socket.close(1008, "Token de chat no válido");
          }
          
          // Autenticado
          fastify.log.info(`🔌 ¡Conexión WS de Chat exitosa! Cliente conectado a: ${chatId}`);
          
          if (!chatRooms.has(chatId)) {
            chatRooms.set(chatId, new Set());
          }
          const room = chatRooms.get(chatId);
          room.add(socket);

          socket.send(JSON.stringify({ type: "welcome", message: `¡Bienvenido a la sala ${chatId}!` }));

          socket.on('close', () => {
            fastify.log.info(`❌ Cliente desconectado de la sala de chat: ${chatId}`);
            room.delete(socket);
            if (room.size === 0) {
              chatRooms.delete(chatId);
            }
          });

        } else {
          fastify.log.warn('Conexión WebSocket sin chatId ni dashboardId. Cerrando.');
          return socket.close(1000, "Propósito no especificado");
        }

      } catch (err) {
        fastify.log.error({ err }, "Error en el listener de conexión de WebSocket.");
        socket.close();
      }
    });
  });

  fastify.get('/ws', { websocket: true }, (connection, req) => {
    // La lógica se maneja en el listener global.
  });
}

module.exports = fp(websocketPlugin);