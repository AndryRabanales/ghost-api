const fp = require('fastify-plugin');

async function websocketPlugin(fastify, options) {
  
  const chatRooms = new Map();

  fastify.addHook('onReady', () => {
    fastify.log.info('Plugin de WebSocket listo. Adjuntando listener de conexión global...');

    fastify.websocketServer.on('connection', (socket, req) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const chatId = url.searchParams.get("chatId") || "default";
        
        fastify.log.info(`🔌 ¡Conexión WebSocket exitosa! Cliente conectado a la sala: ${chatId}`);

        if (!chatRooms.has(chatId)) {
          chatRooms.set(chatId, new Set());
        }
        const room = chatRooms.get(chatId);
        room.add(socket);

        socket.send(JSON.stringify({ type: "welcome", message: `¡Bienvenido a la sala ${chatId}!` }));

        socket.on('message', (message) => {
          fastify.log.info(`[${chatId}] Mensaje recibido: ${message}`);
          const payload = JSON.stringify({
            type: "message",
            content: message.toString(),
          });
          
          for (const client of room) {
              if (client.readyState === 1) { // 1 === WebSocket.OPEN
                  client.send(payload);
              }
          }
        });

        socket.on('close', () => {
          fastify.log.info(`❌ Cliente desconectado de la sala: ${chatId}`);
          room.delete(socket);
          if (room.size === 0) {
            chatRooms.delete(chatId);
          }
        });

      } catch (err) {
        fastify.log.error({ err }, "Error en el listener de conexión de WebSocket.");
        socket.close();
      }
    });
  });

  // Ruta 'dummy' para activar el mecanismo de WebSocket
  fastify.get('/ws/chat', { websocket: true }, (connection, req) => {
    // La lógica está en el listener global, aquí no se hace nada.
  });
}

module.exports = fp(websocketPlugin);