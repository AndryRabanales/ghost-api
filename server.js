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

/* CREATOR (DASHBOARD) */
fastify.post('/creators', async (req, reply) => {
  try {
    const { name } = req.body;

    const dashboardId = uuidv4();
    const publicId = uuidv4();

    await prisma.creator.create({
      data: {
        id: dashboardId,
        publicId,
        name,
      },
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const dashboardUrl = `${baseUrl}/dashboard/${dashboardId}`;
    const publicUrl = `${baseUrl}/u/${publicId}`;

    reply.code(201).send({ dashboardUrl, publicUrl });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando dashboard' });
  }
});

/* MENSAJES */
fastify.post('/messages', async (req, reply) => {
  try {
    const { content, alias, publicId } = req.body;
    if (!content || !publicId) {
      return reply.code(400).send({ error: 'Faltan campos obligatorios' });
    }

    const creator = await prisma.creator.findUnique({
      where: { publicId },
    });
    if (!creator) {
      return reply.code(404).send({ error: 'No se encontró creator' });
    }

    const message = await prisma.message.create({
      data: {
        content,
        alias,
        creatorId: creator.id,
      },
    });

    reply.code(201).send(message);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando mensaje' });
  }
});

fastify.get('/messages', async (req, reply) => {
  try {
    const { dashboardId } = req.query;
    if (!dashboardId) {
      return reply.code(400).send({ error: 'Falta dashboardId en query' });
    }

    const messages = await prisma.message.findMany({
      where: { creatorId: dashboardId },
      orderBy: { createdAt: 'desc' },
    });

    reply.send(messages);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo mensajes' });
  }
});

fastify.patch('/messages/:id', async (req, reply) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updated = await prisma.message.update({
      where: { id },
      data: { status },
    });

    reply.send(updated);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error actualizando mensaje' });
  }
});

fastify.get('/', async (req, reply) => {
  reply.send({ status: 'API funcionando' });
});

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
