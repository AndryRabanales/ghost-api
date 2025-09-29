const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const fastify = Fastify({ logger: true });

fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS', 'PUT', 'DELETE'],
  preflight: true
});

const prisma = new PrismaClient();

/* ======================
   CREATOR (DASHBOARD)
   ====================== */
fastify.post('/creators', async (req, reply) => {
  try {
    const { name } = req.body;

    const dashboardId = uuidv4();
    const publicId = uuidv4();

    await prisma.creator.create({
      data: { id: dashboardId, publicId, name },
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const dashboardUrl = `${baseUrl}/dashboard/${dashboardId}`;
    const publicUrl = `${baseUrl}/u/${publicId}`;

    reply.code(201).send({
      dashboardUrl,
      publicUrl,
      dashboardId,
      publicId,
      name,
    });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando dashboard' });
  }
});

/* ======================
   CHATS BIDIRECCIONALES
   ====================== */

fastify.post('/chats', async (req, reply) => {
  try {
    const { publicId, content, alias } = req.body;
    if (!content || !publicId) {
      return reply.code(400).send({ error: 'Faltan campos obligatorios (publicId, content)' });
    }

    const creator = await prisma.creator.findUnique({ where: { publicId } });
    if (!creator) return reply.code(404).send({ error: 'Creator no encontrado' });

    const anonToken = uuidv4();
    const chat = await prisma.chat.create({
      data: { creatorId: creator.id, anonToken },
    });

    await prisma.chatMessage.create({
      data: { chatId: chat.id, from: 'anon', content, alias },
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const chatUrl = `${baseUrl}/chats/${anonToken}/${chat.id}`;

    reply.code(201).send({
      chatId: chat.id,
      anonToken,
      chatUrl,
      creatorName: creator.name,
    });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando chat' });
  }
});

fastify.get('/chats/:anonToken', async (req, reply) => {
  try {
    const { anonToken } = req.params;
    const chat = await prisma.chat.findUnique({
      where: { anonToken },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        creator: true,
      },
    });
    if (!chat) return reply.code(404).send({ error: 'Chat no encontrado' });
    reply.send(chat);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo chat' });
  }
});

fastify.get('/chats/:anonToken/:chatId', async (req, reply) => {
  try {
    const { anonToken, chatId } = req.params;
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, anonToken },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        creator: true,
      },
    });
    if (!chat) return reply.code(404).send({ error: 'Chat no encontrado' });
    reply.send({
      messages: chat.messages,
      creatorName: chat.creator?.name || null,
    });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo mensajes del chat' });
  }
});

fastify.post('/chats/:anonToken/:chatId/messages', async (req, reply) => {
  try {
    const { anonToken, chatId } = req.params;
    const { content, alias } = req.body;
    if (!content) return reply.code(400).send({ error: 'Falta content' });

    const chat = await prisma.chat.findFirst({
      where: { id: chatId, anonToken },
    });
    if (!chat) return reply.code(404).send({ error: 'Chat no encontrado' });

    const msg = await prisma.chatMessage.create({
      data: { chatId: chat.id, from: 'anon', content, alias },
    });

    reply.code(201).send(msg);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error enviando mensaje' });
  }
});

/* ======================
   DASHBOARD (CREADOR)
   ====================== */

fastify.get('/dashboard/:creatorId/chats', async (req, reply) => {
  try {
    const { creatorId } = req.params;
    const chats = await prisma.chat.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        creator: true,
      },
    });
    reply.send(chats);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error listando chats del dashboard' });
  }
});

fastify.get('/dashboard/chats/:chatId', async (req, reply) => {
  try {
    const { chatId } = req.params;
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        creator: true,
      },
    });
    if (!chat) return reply.code(404).send({ error: 'Chat no encontrado' });
    reply.send({
      messages: chat.messages,
      creatorName: chat.creator?.name || null,
    });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo chat del dashboard' });
  }
});

fastify.post('/dashboard/chats/:chatId/messages', async (req, reply) => {
  try {
    const { chatId } = req.params;
    const { content } = req.body;
    if (!content) return reply.code(400).send({ error: 'Falta content' });

    const msg = await prisma.chatMessage.create({
      data: { chatId, from: 'creator', content },
    });

    reply.code(201).send(msg);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error respondiendo en chat' });
  }
});

/* ======================
   ABRIR MENSAJE (CONSUME VIDA)
   ====================== */
   fastify.post('/dashboard/:creatorId/open-message/:messageId', async (req, reply) => {
    try {
      const { creatorId, messageId } = req.params;
  
      // 1) Buscar creador
      let creator = await prisma.creator.findUnique({ where: { id: creatorId } });
      if (!creator) return reply.code(404).send({ error: 'Creator no encontrado' });
  
      // 2) Buscar mensaje primero (para decidir si hay que cobrar)
      const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      if (!message) return reply.code(404).send({ error: 'Mensaje no encontrado' });
  
      // 3) Si premium -> no cobra, devolver tal cual + vidas actuales
      if (creator.isPremium) {
        // marcar visto si era anónimo y no estaba visto (opcional)
        if (message.from === 'anon' && !message.seen) {
          await prisma.chatMessage.update({ where: { id: messageId }, data: { seen: true } });
        }
        return reply.send({ ...message, lives: creator.lives });
      }
  
      // 4) No premium:
      //    Si el mensaje NO es de 'anon' o YA está visto -> NO descuenta vida (idempotente)
      if (message.from !== 'anon' || message.seen === true) {
        return reply.send({ ...message, lives: creator.lives });
      }
  
      // 5) Recarga de vidas si aplica
      const now = new Date();
      let lives = creator.lives;
      let lastRefillAt = creator.lastRefillAt || new Date(0);
      const diffMin = Math.floor((now - lastRefillAt) / (1000 * 60));
      if (diffMin >= 30 && lives < 5) {
        const add = Math.min(Math.floor(diffMin / 30), 5 - lives);
        lives += add;
        lastRefillAt = now;
        await prisma.creator.update({
          where: { id: creatorId },
          data: { lives, lastRefillAt }
        });
        creator = await prisma.creator.findUnique({ where: { id: creatorId } });
      }
  
      // 6) Verificar vidas
      if (creator.lives <= 0) {
        return reply.code(403).send({ error: 'Sin vidas disponibles, espera 30 min o compra Premium' });
      }
  
      // 7) Consumir 1 vida SOLO si es un mensaje anónimo NO visto (caso idempotente)
      await prisma.creator.update({
        where: { id: creatorId },
        data: { lives: { decrement: 1 }, lastRefillAt: creator.lastRefillAt }
      });
  
      // 8) Marcar como visto
      await prisma.chatMessage.update({ where: { id: messageId }, data: { seen: true } });
  
      // 9) Releer vidas y responder
      creator = await prisma.creator.findUnique({ where: { id: creatorId } });
      const freshMsg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  
      reply.send({ ...freshMsg, lives: creator.lives });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: err.message || 'Error abriendo mensaje' });
    }
  });
  

/* ======================
   MARCAR MENSAJE COMO LEÍDO
   ====================== */
fastify.patch('/chat-messages/:id', async (req, reply) => {
  try {
    const { id } = req.params;
    const { seen } = req.body;
    const updated = await prisma.chatMessage.update({
      where: { id },
      data: { seen },
    });
    reply.send(updated);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error actualizando mensaje' });
  }
});

/* ======================
   UTILIDADES
   ====================== */
fastify.get('/', async () => ({ status: 'API ok' }));

const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3001, host: '0.0.0.0' });
    console.log(`Servidor en puerto ${process.env.PORT || 3001}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
