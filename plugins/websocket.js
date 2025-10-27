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

  // --- CAMBIO 1: Estructura para Anónimos ---
  // Guardaremos sockets por anonToken para encontrarlos fácilmente.
  // Un socket puede estar en MÚLTIPLES sets si escucha varios tokens.
  const anonTokenRooms = new Map(); // Map<anonToken: string, Set<WebSocket>>
  const dashboardRooms = new Map(); // Map<dashboardId: string, Set<WebSocket>>

  // --- LÓGICA DE BROADCAST (Redis - Sin Cambios) ---
  function broadcastToRedis(targetChannel, payload) {
    const message = JSON.stringify({ channel: targetChannel, payload });
    publisher.publish(REDIS_CHANNEL, message);
    fastify.log.info(`📡 Publicado en Redis: ${targetChannel}`);
  }

  // --- CAMBIO 2: Modificar broadcastToChat ---
  // Ahora buscará por anonToken asociado al chat.
  async function broadcastToChat(chatId, payload) {
    try {
        const chat = await prisma.chat.findUnique({
            where: { id: chatId },
            select: { anonToken: true } // Solo necesitamos el anonToken
        });
        if (chat && chat.anonToken) {
            // Publica en Redis usando el anonToken como parte del canal
            // Ejemplo: "anon:some-anon-token"
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

  fastify.decorate('broadcastToChat', broadcastToChat);
  fastify.decorate('broadcastToDashboard', broadcastToDashboard);

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
            if (type === 'anon') { // <-- Cambiado de 'chat' a 'anon'
                room = anonTokenRooms.get(id); // Busca por anonToken
            } else if (type === 'dashboard') {
                room = dashboardRooms.get(id);
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
        // --- NUEVO: Aceptar MÚLTIPLES anonTokens ---
        const anonTokensParam = url.searchParams.get("anonTokens"); // Espera "token1,token2,token3"

        // --- Conexión del DASHBOARD (Sin Cambios) ---
        if (dashboardId) {
          const token = url.searchParams.get("token"); // Token JWT
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

            socket.on('close', () => {
                fastify.log.info(`❌ Cliente desconectado (Dashboard): ${dashboardId}`);
                room.delete(socket);
                if (room.size === 0) dashboardRooms.delete(dashboardId);
            });
            // Guardamos el ID en el socket para referencia futura si es necesario
            socket.dashboardId = dashboardId;

          } catch (jwtError) { /* ... manejo de error JWT ... */ return socket.close(1008, "Token inválido"); }

        // --- NUEVO: Conexión ANÓNIMA con Múltiples Tokens ---
        } else if (anonTokensParam) {
            const anonTokens = anonTokensParam.split(',').filter(Boolean); // Divide y elimina vacíos
            if (anonTokens.length === 0) {
                 fastify.log.warn('Conexión anónima SIN anonTokens válidos. Cerrando.');
                 return socket.close(1008, "anonTokens no proporcionados");
            }

            // Aquí NO validamos los tokens contra la BD en la conexión inicial
            // Lo haremos al enviar mensajes. Confiamos en que el frontend envía los correctos.
            // Esto simplifica la conexión y evita N consultas a la BD.

            fastify.log.info(`🔌 Conexión WS Anónima escuchando ${anonTokens.length} tokens: [${anonTokens.join(', ')}]`);

            // Añadir este socket a la "sala" de CADA anonToken que escucha
            for (const token of anonTokens) {
                if (!anonTokenRooms.has(token)) {
                    anonTokenRooms.set(token, new Set());
                }
                anonTokenRooms.get(token).add(socket);
            }
            // Guardamos los tokens en el socket para la limpieza
            socket.anonTokens = anonTokens;

            socket.send(JSON.stringify({ type: "welcome", message: `Conectado como anónimo, escuchando ${anonTokens.length} chats.` }));

            socket.on('close', () => {
                 fastify.log.info(`❌ Cliente desconectado (Anónimo): [${socket.anonTokens?.join(', ')}]`);
                 // Eliminar el socket de TODAS las salas de anonToken a las que pertenecía
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
            });

        // --- Conexión sin propósito definido ---
        } else {
          fastify.log.warn('Conexión WS sin dashboardId ni anonTokens. Cerrando.');
          return socket.close(1000, "Propósito no especificado");
        }

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