const fp = require('fastify-plugin');

async function websocketPlugin(fastify, options) {
  
  const chatRooms = new Map();
  const dashboardRooms = new Map();

  function broadcastToChat(chatId, payload) {
    const room = chatRooms.get(chatId);
    if (!room) {
      fastify.log.info(`Intento de broadcast a sala de chat vacía o inexistente: ${chatId}`);
      return;
    }

    const message = JSON.stringify(payload);
    fastify.log.info(`Broadcasting a ${room.size} cliente(s) en la sala de chat ${chatId}`);
    
    for (const client of room) {
        if (client.readyState === 1) { // 1 === WebSocket.OPEN
            client.send(message);
        }
    }
  }

  function broadcastToDashboard(creatorId, payload) {
    const room = dashboardRooms.get(creatorId);
    if (!room) {
      fastify.log.info(`Intento de broadcast a sala de dashboard vacía o inexistente: ${creatorId}`);
      return;
    }

    const message = JSON.stringify(payload);
    fastify.log.info(`Broadcasting a ${room.size} cliente(s) en la sala de dashboard ${creatorId}`);

    for (const client of room) {
        if (client.readyState === 1) { // 1 === WebSocket.OPEN
            client.send(message);
        }
    }
  }

  fastify.decorate('broadcastToChat', broadcastToChat);
  fastify.decorate('broadcastToDashboard', broadcastToDashboard);

  fastify.addHook('onReady', () => {
    fastify.log.info('Plugin de WebSocket listo. Adjuntando listener de conexión global...');

    fastify.websocketServer.on('connection', (socket, req) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const chatId = url.searchParams.get("chatId");
        const dashboardId = url.searchParams.get("dashboardId");

        if (chatId) {
            fastify.log.info(`🔌 ¡Conexión WebSocket exitosa! Cliente conectado a la sala de chat: ${chatId}`);

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
        } else if (dashboardId) {
            fastify.log.info(`🔌 ¡Conexión WebSocket exitosa! Cliente conectado a la sala de dashboard: ${dashboardId}`);

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
        } else {
            fastify.log.warn('Conexión WebSocket sin chatId ni dashboardId. Cerrando.');
            return socket.close();
        }

      } catch (err) {
        fastify.log.error({ err }, "Error en el listener de conexión de WebSocket.");
        socket.close();
      }
    });
  });

  fastify.get('/ws', { websocket: true }, (connection, req) => {
    // La lógica se maneja en el listener global. No hacer nada aquí.
  });
}

module.exports = fp(websocketPlugin);