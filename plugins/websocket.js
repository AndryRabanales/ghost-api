// plugins/websocket.js
const fp = require('fastify-plugin');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const prisma = new PrismaClient();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const publisher = new Redis(REDIS_URL);
const subscriber = new Redis(REDIS_URL);
const REDIS_CHANNEL = 'ghosty-messages';

async function websocketPlugin(fastify, options) {

  // --- CAMBIO 1: Estructura para Anónimos y Páginas Públicas ---
  const anonTokenRooms = new Map(); // Map<anonToken: string, Set<WebSocket>>
  const dashboardRooms = new Map(); // Map<dashboardId: string, Set<WebSocket>>
  const publicRooms = new Map();    // Map<publicId: string, Set<WebSocket>> (NUEVO)

  // --- LÓGICA DE BROADCAST (Redis - Sin Cambios) ---
  function broadcastToRedis(targetChannel, payload) {
    const message = JSON.stringify({ channel: targetChannel, payload });
    publisher.publish(REDIS_CHANNEL, message);
    fastify.log.info(`📡 Publicado en Redis: ${targetChannel}`);
  }

  // --- broadcastToChat (Sin Cambios respecto a tu original) ---
  async function broadcastToChat(chatId, payload) {
    try {
        const chat = await prisma.chat.findUnique({
            where: { id: chatId },
            select: { anonToken: true } 
        });
        if (chat && chat.anonToken) {
            broadcastToRedis(`anon:${chat.anonToken}`, payload);
        } else {
             fastify.log.warn(`Chat ${chatId} no encontrado o sin anonToken para broadcast.`);
        }
    } catch (error) {
        fastify.log.error({ err: error, chatId }, "Error buscando anonToken para broadcastToChat");
    }
  }

  // broadcastToDashboard (Sin Cambios)
  function broadcastToDashboard(creatorId, payload) {
    broadcastToRedis(`dashboard:${creatorId}`, payload);
  }

  // --- CAMBIO 2: NUEVA FUNCION ---
  function broadcastToPublic(publicId, payload) {
    broadcastToRedis(`public:${publicId}`, payload);
  }

  fastify.decorate('broadcastToChat', broadcastToChat);
  fastify.decorate('broadcastToDashboard', broadcastToDashboard);
  fastify.decorate('broadcastToPublic', broadcastToPublic); // <-- AÑADIDO

  fastify.addHook('onReady', () => {
    fastify.log.info('Plugin de WebSocket listo.');

    // --- Suscripción a Redis (Sin Cambios) ---
    subscriber.subscribe(REDIS_CHANNEL, (err, count) => { /* ... */ });

    // --- CAMBIO 3: Manejo de Mensajes Redis Modificado ---
    subscriber.on('message', (channel, message) => {
        try {
            const { channel: targetChannel, payload } = JSON.parse(message);
            const [type, id] = targetChannel.split(':');

            let room;
            if (type === 'anon') { 
                room = anonTokenRooms.get(id); 
            } else if (type === 'dashboard') {
                room = dashboardRooms.get(id);
            } else if (type === 'public') { // <-- AÑADIDO
                room = publicRooms.get(id); // <-- AÑADIDO
            }

            if (room && room.size > 0) {
                fastify.log.info(`📩 Reenviando mensaje de Redis a ${room.size} sockets locales en ${targetChannel}`);
                const msg = JSON.stringify(payload);
                for (const socket of room) {
                    if (socket.readyState === 1) { // WebSocket.OPEN
                        socket.send(msg);
                    }
                }
            } else {
               // fastify.log.trace(`No hay sockets locales escuchando ${targetChannel}`);
            }
        } catch (e) {
            fastify.log.error('Error procesando mensaje de Redis:', e);
        }
    });


    // --- CAMBIO 4: Lógica de Conexión Modificada ---
    fastify.websocketServer.on('connection', async (socket, req) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const dashboardId = url.searchParams.get("dashboardId");
        const anonTokensParam = url.searchParams.get("anonTokens");
        const publicId = url.searchParams.get("publicId"); // <-- AÑADIDO

        let connectionPurposeFound = false; // <-- Control para cerrar conexiones sin propósito

        // --- Conexión del DASHBOARD ---
        if (dashboardId) {
          connectionPurposeFound = true; // <-- Control
          const token = url.searchParams.get("token"); 
          if (!token) { /* ... manejo de error ... */ return socket.close(1008, "Token no proporcionado"); }
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.id !== dashboardId) { /* ... manejo de error ... */ return socket.close(1008, "Token no válido para este dashboard"); }

            fastify.log.info(`🔌 Conexión WS de Dashboard: ${dashboardId}`);
            if (!dashboardRooms.has(dashboardId)) {
                dashboardRooms.set(dashboardId, new Set());
            }
            const room = dashboardRooms.get(dashboardId);
            room.add(socket);
            socket.send(JSON.stringify({ type: "welcome", message: `Conectado al dashboard ${dashboardId}` }));

            // (La limpieza de 'close' se movió más abajo)
            socket.dashboardId = dashboardId;

          } catch (jwtError) { /* ... manejo de error JWT ... */ return socket.close(1008, "Token inválido"); }
        }

        // --- Conexión ANÓNIMA con Múltiples Tokens ---
        if (anonTokensParam) {
            const anonTokens = anonTokensParam.split(',').filter(Boolean); 
            if (anonTokens.length > 0) {
                connectionPurposeFound = true; // <-- Control
                fastify.log.info(`🔌 Conexión WS Anónima escuchando ${anonTokens.length} tokens: [${anonTokens.join(', ')}]`);
    
                for (const token of anonTokens) {
                    if (!anonTokenRooms.has(token)) {
                        anonTokenRooms.set(token, new Set());
                    }
                    anonTokenRooms.get(token).add(socket);
                }
                socket.anonTokens = anonTokens;
                socket.send(JSON.stringify({ type: "welcome", message: `Conectado como anónimo, escuchando ${anonTokens.length} chats.` }));
            }
        }

        // --- NUEVO: Conexión de PÁGINA PÚBLICA ---
        if (publicId) {
          connectionPurposeFound = true; // <-- Control
          fastify.log.info(`🔌 Conexión WS Pública escuchando: ${publicId}`);
          if (!publicRooms.has(publicId)) {
              publicRooms.set(publicId, new Set());
          }
          const room = publicRooms.get(publicId);
          room.add(socket);
          socket.publicIdListening = publicId;
        }

        // --- Conexión sin propósito definido ---
        if (!connectionPurposeFound) { // <-- Control
          fastify.log.warn('Conexión WS sin dashboardId, anonTokens, ni publicId. Cerrando.');
          return socket.close(1000, "Propósito no especificado");
        }
        
        // --- CAMBIO 5: Limpieza centralizada en 'close' ---
        socket.on('close', () => {
             fastify.log.info(`❌ Cliente desconectado (Dashboard: ${socket.dashboardId}, Anónimo: [${socket.anonTokens?.join(', ')}], Público: ${socket.publicIdListening})`);
             
             // Limpieza de dashboardRooms
             if (socket.dashboardId) {
                const room = dashboardRooms.get(socket.dashboardId);
                if (room) {
                    room.delete(socket);
                    if (room.size === 0) dashboardRooms.delete(socket.dashboardId);
                }
             }
             
             // Limpieza de anonTokenRooms
             if (socket.anonTokens) {
                 for (const token of socket.anonTokens) {
                     const room = anonTokenRooms.get(token);
                     if (room) {
                         room.delete(socket);
                         if (room.size === 0) {
                             anonTokenRooms.delete(token);
                         }
                     }
                 }
             }

             // Limpieza de publicRooms (NUEVO)
             if (socket.publicIdListening) {
                const room = publicRooms.get(socket.publicIdListening);
                if (room) {
                  room.delete(socket);
                  if (room.size === 0) {
                    publicRooms.delete(socket.publicIdListening);
                  }
                }
             }
        });

      } catch (err) {
        fastify.log.error({ err }, "Error en listener de conexión WS.");
        socket.close();
      }
    });
  });

  // Ruta /ws (Sin Cambios)
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    // La lógica se maneja en el listener global 'connection'.
  });
}

module.exports = fp(websocketPlugin);