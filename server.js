const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const fastify = Fastify({ logger: true });

fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
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

    // guardamos también el nombre del creador
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
      name, // devolvemos nombre
    });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando dashboard' });
  }
});

/* ======================
   CHATS BIDIRECCIONALES
   ====================== */

// Crear chat + primer mensaje del ANÓNIMO
fastify.post('/chats', async (req, reply) => {
  try {
    const { publicId, content, alias } = req.body;
    if (!content || !publicId) {
      return reply
        .code(400)
        .send({ error: 'Faltan campos obligatorios (publicId, content)' });
    }

    const creator = await prisma.creator.findUnique({ where: { publicId } });
    if (!creator)
      return reply.code(404).send({ error: 'Creator no encontrado' });

    const anonToken = uuidv4();
    const chat = await prisma.chat.create({
      data: { creatorId: creator.id, anonToken },
    });

    // guardamos alias en el primer mensaje
    await prisma.chatMessage.create({
      data: { chatId: chat.id, from: 'anon', content, alias },
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const chatUrl = `${baseUrl}/chats/${anonToken}/${chat.id}`;

    reply.code(201).send({
      chatId: chat.id,
      anonToken,
      chatUrl,
      creatorName: creator.name, // devolvemos nombre del creador también
    });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando chat' });
  }
});

// Listar resumen de un chat por anonToken (token ÚNICO de ese chat)
fastify.get('/chats/:anonToken', async (req, reply) => {
  try {
    const { anonToken } = req.params;
    const chat = await prisma.chat.findUnique({
      where: { anonToken },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        creator: true, // incluimos datos del creador
      },
    });
    if (!chat) return reply.code(404).send({ error: 'Chat no encontrado' });
    reply.send(chat);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo chat' });
  }
});

// Obtener mensajes de un chat (ANÓNIMO) — requiere anonToken + chatId
fastify.get('/chats/:anonToken/:chatId', async (req, reply) => {
  try {
    const { anonToken, chatId } = req.params;
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, anonToken },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        creator: true, // incluimos datos del creador
      },
    });
    if (!chat) return reply.code(404).send({ error: 'Chat no encontrado' });
    reply.send({
      messages: chat.messages,
      creatorName: chat.creator?.name || null, // devolvemos nombre del creador
    });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({
      error: err.message || 'Error obteniendo mensajes del chat',
    });
  }
});

// Enviar mensaje (ANÓNIMO) en un chat
fastify.post('/chats/:anonToken/:chatId/messages', async (req, reply) => {
  try {
    const { anonToken, chatId } = req.params;
    const { content, alias } = req.body; // leemos alias también
    if (!content) return reply.code(400).send({ error: 'Falta content' });

    const chat = await prisma.chat.findFirst({
      where: { id: chatId, anonToken },
    });
    if (!chat) return reply.code(404).send({ error: 'Chat no encontrado' });

    const msg = await prisma.chatMessage.create({
      data: { chatId: chat.id, from: 'anon', content, alias }, // guardamos alias
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

// Listar chats por creatorId (dashboard)
fastify.get('/dashboard/:creatorId/chats', async (req, reply) => {
  try {
    const { creatorId } = req.params;
    const chats = await prisma.chat.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        creator: true, // incluimos nombre del creador
      },
    });
    reply.send(chats);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error listando chats del dashboard' });
  }
});

// Ver un chat completo (CREADOR) por chatId
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
      creatorName: chat.creator?.name || null, // devolvemos nombre del creador
    });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo chat del dashboard' });
  }
});

// Responder en chat (CREADOR)
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
