const fp = require('fastify-plugin');

async function websocketPlugin(fastify, options) {
  
  const chatRooms = new Map();

  // 1. CREAMOS LA FUNCIÓN PARA ENVIAR MENSAJES
  function broadcastMessage(chatId, payload) {
    const room = chatRooms.get(chatId);
    if (!room) {
      fastify.log.info(`Intento de broadcast a sala vacía o inexistente: ${chatId}`);
      return;
    }

    const message = JSON.stringify(payload);
    fastify.log.info(`Broadcasting a ${room.size} cliente(s) en la sala ${chatId}`);
    
    for (const client of room) {
        if (client.readyState === 1) { // 1 === WebSocket.OPEN
            client.send(message);
        }
    }
  }

  // 2. HACEMOS LA FUNCIÓN ACCESIBLE EN TODA LA APP
  fastify.decorate('broadcast', broadcastMessage);

  fastify.addHook('onReady', () => {
    fastify.log.info('Plugin de WebSocket listo. Adjuntando listener de conexión global...');

    fastify.websocketServer.on('connection', (socket, req) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const chatId = url.searchParams.get("chatId"); // Obtenemos el chatId de la URL

        if (!chatId) {
          fastify.log.warn('Conexión WebSocket sin chatId. Cerrando.');
          return socket.close();
        }
        
        fastify.log.info(`🔌 ¡Conexión WebSocket exitosa! Cliente conectado a la sala: ${chatId}`);

        if (!chatRooms.has(chatId)) {
          chatRooms.set(chatId, new Set());
        }
        const room = chatRooms.get(chatId);
        room.add(socket);

        socket.send(JSON.stringify({ type: "welcome", message: `¡Bienvenido a la sala ${chatId}!` }));

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

  // La ruta dummy ahora está dentro del plugin para asegurar el orden de carga
  fastify.get('/ws/chat', { websocket: true }, (connection, req) => {
    // La lógica se maneja en el listener global. No hacer nada aquí.
  });
}

module.exports = fp(websocketPlugin);