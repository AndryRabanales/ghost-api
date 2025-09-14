// api/server.js  (ESM)
const Fastify = require('fastify');
const { PrismaClient } = require('@prisma/client');

// resto igual…


const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

fastify.post('/messages', async (request, reply) => {
  const { content, userId } = request.body;
  const message = await prisma.message.create({
    data: { content, userId }
  });
  reply.code(201).send(message);
});

fastify.get('/messages', async (request, reply) => {
  const messages = await prisma.message.findMany({
    orderBy: { createdAt: 'desc' }
  });
  reply.send(messages);
});

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
