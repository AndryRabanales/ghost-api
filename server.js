const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { PrismaClient } = require('@prisma/client');

const fastify = Fastify({ logger: true });

fastify.register(cors, {
  origin: '*', // o pon aquí tu URL de producción para restringirlo
});

const prisma = new PrismaClient();

// Crear predicción (status queda PENDING por defecto)
fastify.post('/messages', async (request, reply) => {
  const { content, userId } = request.body;
  const message = await prisma.message.create({
    data: { content, userId }
  });
  reply.code(201).send(message);
});

// Contar predicciones bloqueadas (igual que antes)
fastify.get('/messages/count', async (request, reply) => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const locked = await prisma.message.count({
    where: { createdAt: { gt: cutoff } } // más nuevos = bloqueados
  });
  reply.send({ locked });
});

// NUEVO: Listar sólo predicciones desbloqueadas (>24h)
fastify.get('/messages/unlocked', async (request, reply) => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const messages = await prisma.message.findMany({
    where: { createdAt: { lte: cutoff } },
    orderBy: { createdAt: 'desc' }
  });
  reply.send(messages);
});

// NUEVO: Listar todos los mensajes
fastify.get('/messages', async (request, reply) => {
  const messages = await prisma.message.findMany({
    orderBy: { createdAt: 'desc' }
  });
  reply.send(messages);
});

// NUEVO: Marcar predicción cumplida o no cumplida
fastify.patch('/messages/:id', async (request, reply) => {
  const { status } = request.body; // 'FULFILLED' o 'NOT_FULFILLED'
  if (!['FULFILLED', 'NOT_FULFILLED'].includes(status)) {
    return reply.code(400).send({ error: 'Estado inválido' });
  }
  const message = await prisma.message.update({
    where: { id: request.params.id },
    data: {
      seen: true, // marca como visto al mismo tiempo
      status
    }
  });
  reply.send(message);
});

// Iniciar servidor
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
