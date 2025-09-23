const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { PrismaClient } = require('@prisma/client');

const fastify = Fastify({ logger: true });

fastify.register(cors, {
  origin: '*', // o tu URL de producción para restringirlo
});

const prisma = new PrismaClient();

// Crear una nueva ronda
fastify.post('/rounds', async (request, reply) => {
  const { creatorId } = request.body;
  const round = await prisma.round.create({
    data: { creatorId } // status ACTIVE por defecto
  });
  reply.send(round);
});

// Obtener la ronda activa del creador
fastify.get('/rounds/current/:creatorId', async (request, reply) => {
  const round = await prisma.round.findFirst({
    where: { creatorId: request.params.creatorId, status: 'ACTIVE' },
    orderBy: { date: 'desc' }
  });
  reply.send(round);
});

// Enviar predicción a una ronda (status queda PENDING por defecto)
fastify.post('/messages', async (request, reply) => {
  const { content, userId, roundId } = request.body;
  const message = await prisma.message.create({
    data: { content, userId, roundId }
  });
  reply.code(201).send(message);
});

// Listar mensajes de una ronda concreta
fastify.get('/messages/:roundId', async (request, reply) => {
  const messages = await prisma.message.findMany({
    where: { roundId: request.params.roundId },
    orderBy: { createdAt: 'desc' }
  });
  reply.send(messages);
});

// Marcar predicción cumplida o no cumplida
fastify.patch('/messages/:id', async (request, reply) => {
  const { status } = request.body; // 'FULFILLED' o 'NOT_FULFILLED'
  if (!['FULFILLED', 'NOT_FULFILLED'].includes(status)) {
    return reply.code(400).send({ error: 'Estado inválido' });
  }
  const message = await prisma.message.update({
    where: { id: request.params.id },
    data: {
      seen: true,
      status
    }
  });
  reply.send(message);
});

// Arrancar el servidor
const start = async () => {
  try {
    const port = process.env.PORT || 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Servidor en puerto ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
