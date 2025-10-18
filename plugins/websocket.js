// plugins/websocket.js (Código final con lógica Redis Pub/Sub)
const fp = require('fastify-plugin');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis'); 
const prisma = new PrismaClient();

// El código ahora lee la variable REDIS_URL que ya tienes en Railway.
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const publisher = new Redis(REDIS_URL); 
const subscriber = new Redis(REDIS_URL); 
const REDIS_CHANNEL = 'ghosty-messages';

async function websocketPlugin(fastify, options) {
  
  const chatRooms = new Map();
  const dashboardRooms = new Map();

  function broadcastToRedis(targetChannel, payload) {
    const message = JSON.stringify({ channel: targetChannel, payload });
    publisher.publish(REDIS_CHANNEL, message);
    fastify.log.info(`📡 Publicado en Redis: ${targetChannel}`);
  }

  function broadcastToChat(chatId, payload) {
    broadcastToRedis(`chat:${chatId}`, payload);
  }

  function broadcastToDashboard(creatorId, payload) {
    broadcastToRedis(`dashboard:${creatorId}`, payload);
  }

  fastify.decorate('broadcastToChat', broadcastToChat);
  fastify.decorate('broadcastToDashboard', broadcastToDashboard);

  fastify.addHook('onReady', () => {
    fastify.log.info('Plugin de WebSocket listo. Adjuntando listener de conexión global...');

    // --- Lógica de Redis SUBSCRIBE ---
    subscriber.subscribe(REDIS_CHANNEL, (err, count) => {
        if (err) fastify.log.error('Error al suscribirse a Redis:', err);
        else fastify.log.info(`✅ Suscrito a ${count} canal(es) de Redis: ${REDIS_CHANNEL}`);
    });

    subscriber.on('message', (channel, message) => {
        try {
            const { channel: targetChannel, payload } = JSON.parse(message);
            const [type, id] = targetChannel.split(':');
            
            let room;
            if (type === 'chat') {
                room = chatRooms.get(id);
            } else if (type === 'dashboard') {
                room = dashboardRooms.get(id);
            }

            if (room) {
                fastify.log.info(`📩 Reenviando mensaje de Redis a ${room.size} sockets locales en ${targetChannel}`);
                const msg = JSON.stringify(payload);
                for (const socket of room) {
                    if (socket.readyState === 1) {
                        socket.send(msg);
                    }
                }
            }
        } catch (e) {
            fastify.log.error('Error procesando mensaje de Redis:', e);
        }
    });
    // --- FIN Lógica de Redis SUBSCRIBE ---

    // ... (El resto de la función fastify.websocketServer.on('connection') se queda igual)
    // ... (porque maneja la lógica de conexión y desconexión locales)
    
  });

  fastify.get('/ws', { websocket: true }, (connection, req) => {
    // La lógica se maneja en el listener global.
  });
}

module.exports = fp(websocketPlugin);