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
    await fastify.listen({ port: 3001 });
    console.log('Servidor en http://localhost:3001');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
