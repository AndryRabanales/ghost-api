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

  const anonTokenRooms = new Map(); // Map<anonToken: string, Set<WebSocket>>
  const dashboardRooms = new Map(); // Map<dashboardId: string, Set<WebSocket>>
  const publicRooms = new Map();    // Map<publicId: string, Set<WebSocket>>

  function broadcastToRedis(targetChannel, payload) {
    const message = JSON.stringify({ channel: targetChannel, payload });
    publisher.publish(REDIS_CHANNEL, message);
    fastify.log.info(`📡 Publicado en Redis: ${targetChannel}`);
  }

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

  function broadcastToDashboard(creatorId, payload) {
    broadcastToRedis(`dashboard:${creatorId}`, payload);
  }

  function broadcastToPublic(publicId, payload) {
    broadcastToRedis(`public:${publicId}`, payload);
  }

  fastify.decorate('broadcastToChat', broadcastToChat);
  fastify.decorate('broadcastToDashboard', broadcastToDashboard);
  fastify.decorate('broadcastToPublic', broadcastToPublic);

  fastify.addHook('onReady', () => {
    fastify.log.info('Plugin de WebSocket listo.');

    subscriber.subscribe(REDIS_CHANNEL, (err, count) => { /* ... */ });

    subscriber.on('message', (channel, message) => {
        try {
            const { channel: targetChannel, payload } = JSON.parse(message);
            const [type, id] = targetChannel.split(':');

            let room;
            if (type === 'anon') { 
                room = anonTokenRooms.get(id); 
            } else if (type === 'dashboard') {
                room = dashboardRooms.get(id);
            } else if (type === 'public') {
                room = publicRooms.get(id);
            }

            if (room && room.size > 0) {
                fastify.log.info(`📩 Reenviando mensaje de Redis a ${room.size} sockets locales en ${targetChannel}`);
                const msg = JSON.stringify(payload);
                for (const socket of room) {
                    if (socket.readyState === 1) { // WebSocket.OPEN
                        socket.send(msg);
                    }
                }
            }
        } catch (e) {
            fastify.log.error('Error procesando mensaje de Redis:', e);
        }
    });


    fastify.websocketServer.on('connection', async (socket, req) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const dashboardId = url.searchParams.get("dashboardId");
        const anonTokensParam = url.searchParams.get("anonTokens");
        const publicId = url.searchParams.get("publicId");

        let connectionPurposeFound = false;

        // --- Conexión del DASHBOARD ---
        if (dashboardId) {
          connectionPurposeFound = true;
          const token = url.searchParams.get("token"); 
          if (!token) { return socket.close(1008, "Token no proporcionado"); }
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.id !== dashboardId) { return socket.close(1008, "Token no válido para este dashboard"); }

            // --- 👇 LÓGICA DE PRESENCIA (CREATOR) 👇 ---
            const creatorPublicId = decoded.publicId; 
            socket.publicId = creatorPublicId; // Guardamos publicId para el disconnect
            socket.dashboardId = dashboardId;

            fastify.log.info(`🔌 Conexión WS de Dashboard: ${dashboardId} (Public: ${creatorPublicId})`);
            if (!dashboardRooms.has(dashboardId)) {
                dashboardRooms.set(dashboardId, new Set());
            }
            const room = dashboardRooms.get(dashboardId);
            room.add(socket);
            
            // Notificar a todos en la página pública que este creador está ONLINE
            fastify.broadcastToPublic(creatorPublicId, {
              type: 'CREATOR_STATUS_UPDATE',
              status: 'online'
            });

            // Enviar estado inicial de Anónimos a ESTE socket de dashboard
            try {
              const creatorsChats = await prisma.chat.findMany({
                where: { creatorId: dashboardId },
                select: { id: true, anonToken: true }
              });
              
              const statusUpdates = creatorsChats.map(chat => {
                const anonRoom = anonTokenRooms.get(chat.anonToken);
                const isOnline = !!anonRoom && anonRoom.size > 0;
                return {
                  type: 'ANON_STATUS_UPDATE',
                  chatId: chat.id,
                  status: isOnline ? 'online' : 'offline'
                };
              });
              for (const update of statusUpdates) {
                socket.send(JSON.stringify(update));
              }
            } catch (e) {
              fastify.log.error(e, "Error al enviar estado inicial de anónimos");
            }
            // --- 👆 FIN LÓGICA DE PRESENCIA (CREATOR) 👆 ---

            socket.send(JSON.stringify({ type: "welcome", message: `Conectado al dashboard ${dashboardId}` }));

          } catch (jwtError) { return socket.close(1008, "Token inválido"); }
        }

        // --- Conexión ANÓNIMA con Múltiples Tokens ---
        if (anonTokensParam) {
            const anonTokens = anonTokensParam.split(',').filter(Boolean); 
            if (anonTokens.length > 0) {
                connectionPurposeFound = true;
                fastify.log.info(`🔌 Conexión WS Anónima escuchando ${anonTokens.length} tokens.`);
    
                for (const token of anonTokens) {
                    if (!anonTokenRooms.has(token)) {
                        anonTokenRooms.set(token, new Set());
                    }
                    anonTokenRooms.get(token).add(socket);

                    // --- 👇 LÓGICA DE PRESENCIA (ANON) 👇 ---
                    // Notificar a los dashboards correspondientes que este anónimo está ONLINE
                    try {
                      const chats = await prisma.chat.findMany({
                        where: { anonToken: token },
                        select: { creatorId: true, id: true, creator: { select: { publicId: true } } } 
                      });
                      let creatorPublicId = null;
                      for (const chat of chats) {
                        fastify.broadcastToDashboard(chat.creatorId, {
                          type: 'ANON_STATUS_UPDATE',
                          chatId: chat.id,
                          status: 'online'
                        });
                        if (chat.creator) creatorPublicId = chat.creator.publicId;
                      }
                      
                      // Enviar estado inicial del Creador a ESTE socket anónimo
                      if (creatorPublicId) {
                         const creator = await prisma.creator.findUnique({ 
                            where: { publicId: creatorPublicId }, 
                            select: { id: true } 
                         });
                         if (creator) {
                            const dashboardRoom = dashboardRooms.get(creator.id);
                            const isOnline = !!dashboardRoom && dashboardRoom.size > 0;
                            socket.send(JSON.stringify({
                              type: 'CREATOR_STATUS_UPDATE',
                              status: isOnline ? 'online' : 'offline'
                            }));
                         }
                      }
                    } catch (e) {
                      fastify.log.error(e, "Error notificando estado online de anónimo");
                    }
                    // --- 👆 FIN LÓGICA DE PRESENCIA (ANON) 👆 ---
                }
                socket.anonTokens = anonTokens;
                socket.send(JSON.stringify({ type: "welcome", message: `Conectado como anónimo, escuchando ${anonTokens.length} chats.` }));
            }
        }

        // --- Conexión de PÁGINA PÚBLICA (Solo estado del creator) ---
        if (publicId) {
          connectionPurposeFound = true;
          fastify.log.info(`🔌 Conexión WS Pública escuchando: ${publicId}`);
          if (!publicRooms.has(publicId)) {
              publicRooms.set(publicId, new Set());
          }
          const room = publicRooms.get(publicId);
          room.add(socket);
          socket.publicIdListening = publicId;

          // --- 👇 LÓGICA DE ESTADO INICIAL (CREATOR) 👇 ---
          try {
            const creator = await prisma.creator.findUnique({ 
              where: { publicId }, 
              select: { id: true } 
            });
            if (creator) {
              const dashboardRoom = dashboardRooms.get(creator.id);
              const isOnline = !!dashboardRoom && dashboardRoom.size > 0;
              socket.send(JSON.stringify({
                type: 'CREATOR_STATUS_UPDATE',
                status: isOnline ? 'online' : 'offline'
              }));
            }
          } catch (e) {
            fastify.log.error(e, "Error al buscar estado inicial del creador");
          }
          // --- 👆 FIN LÓGICA DE ESTADO INICIAL (CREATOR) 👆 ---
        }

        if (!connectionPurposeFound) {
          fastify.log.warn('Conexión WS sin propósito. Cerrando.');
          return socket.close(1000, "Propósito no especificado");
        }
        
        socket.on('close', async () => {
             fastify.log.info(`❌ Cliente desconectado (Dashboard: ${socket.dashboardId}, Anónimo: [${socket.anonTokens?.join(', ')}], Público: ${socket.publicIdListening})`);
             
             // --- Limpieza Dashboard (Notifica "Creator Offline") ---
             if (socket.dashboardId) {
                const room = dashboardRooms.get(socket.dashboardId);
                const creatorPublicId = socket.publicId; 

                if (room && creatorPublicId) {
                    room.delete(socket);
                    if (room.size === 0) {
                        fastify.log.info(`Dashboard ${socket.dashboardId} (Public: ${creatorPublicId}) está OFFLINE.`);
                        fastify.broadcastToPublic(creatorPublicId, {
                          type: 'CREATOR_STATUS_UPDATE',
                          status: 'offline'
                        });
                        dashboardRooms.delete(socket.dashboardId);
                    }
                } else if (room) {
                   room.delete(socket);
                   if (room.size === 0) dashboardRooms.delete(socket.dashboardId);
                }
             }
             
             // --- Limpieza Anónimo (Notifica "Anon Offline") ---
             if (socket.anonTokens) {
                 for (const token of socket.anonTokens) {
                     const room = anonTokenRooms.get(token);
                     if (room) {
                         room.delete(socket);
                         if (room.size === 0) {
                             anonTokenRooms.delete(token);
                             // Notificar a los dashboards que este anónimo se fue
                             try {
                               const chats = await prisma.chat.findMany({
                                 where: { anonToken: token },
                                 select: { creatorId: true, id: true } 
                               });
                               for (const chat of chats) {
                                 fastify.broadcastToDashboard(chat.creatorId, {
                                   type: 'ANON_STATUS_UPDATE',
                                   chatId: chat.id,
                                   status: 'offline',
                                   lastActiveAt: new Date().toISOString() // Enviar "justo ahora"
                                 });
                               }
                             } catch (e) {
                                fastify.log.error(e, "Error notificando estado offline de anónimo");
                             }
                         }
                     }
                 }
             }

             // --- Limpieza Pública (Sin notificación, solo limpia) ---
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

  fastify.get('/ws', { websocket: true }, (connection, req) => {
    // La lógica se maneja en el listener global 'connection'.
  });
}

module.exports = fp(websocketPlugin);