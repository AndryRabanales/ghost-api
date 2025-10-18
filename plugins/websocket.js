// plugins/websocket.js
const fp = require('fastify-plugin');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis'); 
const prisma = new PrismaClient();

// 🚨 CÓDIGO SEGURO: Usamos process.env para leer la variable de entorno.
// El valor de esta variable debe ser la URL pública que funciona.
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'; 

const publisher = new Redis(REDIS_URL); 
const subscriber = new Redis(REDIS_URL); 
const REDIS_CHANNEL = 'ghosty-messages';

async function websocketPlugin(fastify, options) {
  
  const chatRooms = new Map();
  const dashboardRooms = new Map();

  // ===================================
  // LÓGICA DE BROADCAST: PUBLICA A REDIS
  // ===================================

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

    // Manejar mensajes entrantes de Redis y reenviarlos a los sockets locales
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

    fastify.websocketServer.on('connection', async (socket, req) => {
      // (Toda la lógica de conexión y autenticación original)
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const chatId = url.searchParams.get("chatId");
        const dashboardId = url.searchParams.get("dashboardId");
        
        // --- LÓGICA DE AUTENTICACIÓN DE WEBSOCKET ---
        if (dashboardId) {
          const token = url.searchParams.get("token"); // Token JWT
          if (!token) {
            fastify.log.warn('Conexión a dashboard SIN token. Cerrando.');
            return socket.close(1008, "Token no proporcionado");
          }
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.id !== dashboardId) {
              fastify.log.warn(`Token no válido para dashboard ${dashboardId}. Cerrando.`);
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
            fastify.log.warn('Conexión a chat SIN anonToken. Cerrando.');
            return socket.close(1008, "Token no proporcionado");
          }

          // Validar contra la BD
          const chat = await prisma.chat.findFirst({
            where: { id: chatId, anonToken: anonToken }
          });

          if (!chat) {
            fastify.log.warn(`Token de chat no válido para ${chatId}. Cerrando.`);
            return socket.close(1008, "Token de chat no válido");
          }
          
          // Autenticado
          fastify.log.info(`🔌 ¡Conexión WS de Chat exitosa! Cliente conectado a: ${chatId}`);
          
          if (!chatRooms.has(chatId)) {
            chatRooms.set(chatId, new Set());
          }
          const room = chatRooms.get(chatId);
          room.add(socket);

          socket.send(JSON.stringify({ type: "welcome", message: `Conectado al chat ${chatId}` }));

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