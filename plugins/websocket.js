// plugins/websocket.js
const fp = require('fastify-plugin');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis'); // 👈 IMPORTACIÓN CLAVE
const prisma = new PrismaClient();

// 🚨 CONFIGURACIÓN DE REDIS PARA ESCALABILIDAD
// Inicializar clientes de Redis. Usamos un cliente para publicar y otro para suscribir.
// Esto asegura que el Pub/Sub funcione correctamente incluso con una sola URL (REDIS_URL).
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const publisher = new Redis(REDIS_URL); 
const subscriber = new Redis(REDIS_URL); 
const REDIS_CHANNEL = 'ghosty-messages'; // Canal único para todas las notificaciones

async function websocketPlugin(fastify, options) {
  
  // Estos Map se mantienen. Ahora solo almacenan las conexiones **locales**
  // para que, cuando se reciba un mensaje de Redis, sepamos a qué sockets enviarlo.
  const chatRooms = new Map();
  const dashboardRooms = new Map();

  // ===================================
  // LÓGICA DE BROADCAST: AHORA PUBLICA A REDIS
  // ===================================

  /**
   * Función interna para publicar un mensaje con un canal objetivo en Redis.
   */
  function broadcastToRedis(targetChannel, payload) {
    const message = JSON.stringify({ channel: targetChannel, payload });
    // Publica en el canal global de Redis
    publisher.publish(REDIS_CHANNEL, message);
    fastify.log.info(`📡 Publicado en Redis: ${targetChannel}`);
  }

  /**
   * Envía un mensaje a la sala de chat a través de Redis.
   */
  function broadcastToChat(chatId, payload) {
    broadcastToRedis(`chat:${chatId}`, payload);
  }

  /**
   * Envía un mensaje al dashboard del creador a través de Redis.
   */
  function broadcastToDashboard(creatorId, payload) {
    broadcastToRedis(`dashboard:${creatorId}`, payload);
  }
  // ===================================
  // FIN DE LA LÓGICA DE BROADCAST
  // ===================================


  fastify.decorate('broadcastToChat', broadcastToChat);
  fastify.decorate('broadcastToDashboard', broadcastToDashboard);

  fastify.addHook('onReady', () => {
    fastify.log.info('Plugin de WebSocket listo. Adjuntando listener de conexión global...');

    // --- Lógica de Redis SUBSCRIBE (Se ejecuta en CADA réplica) ---
    subscriber.subscribe(REDIS_CHANNEL, (err, count) => {
        if (err) fastify.log.error('Error al suscribirse a Redis:', err);
        else fastify.log.info(`✅ Suscrito a ${count} canal(es) de Redis: ${REDIS_CHANNEL}`);
    });

    // Manejar mensajes entrantes de Redis y reenviarlos a los sockets locales
    subscriber.on('message', (channel, message) => {
        try {
            // 1. Deserializar el mensaje de Redis para obtener el canal objetivo
            const { channel: targetChannel, payload } = JSON.parse(message);
            const [type, id] = targetChannel.split(':');
            
            let room;
            if (type === 'chat') {
                room = chatRooms.get(id); // Obtiene los sockets locales del chat
            } else if (type === 'dashboard') {
                room = dashboardRooms.get(id); // Obtiene los sockets locales del dashboard
            }

            // 2. Si la réplica actual tiene clientes conectados a esa sala/dashboard, reenvía.
            if (room) {
                fastify.log.info(`📩 Reenviando mensaje de Redis a ${room.size} sockets locales en ${targetChannel}`);
                const msg = JSON.stringify(payload);
                for (const socket of room) {
                    if (socket.readyState === 1) { // 1 = WebSocket.OPEN
                        socket.send(msg);
                    }
                }
            }
        } catch (e) {
            fastify.log.error('Error procesando mensaje de Redis:', e);
        }
    });
    // --- FIN Lógica de Redis SUBSCRIBE ---

    fastify.websocketServer.on('connection', async (socket, req) => {
      // (Tu lógica de autenticación y manejo de conexión permanece INTACTA)
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
            return socket.close(1008, "Token de chat no proporcionado");
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