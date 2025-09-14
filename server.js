const Fastify = require('fastify');
const cors = require('@fastify/cors');        // 👈 importa cors
const { PrismaClient } = require('@prisma/client');

const fastify = Fastify({ logger: true });

// 👇 registra CORS
fastify.register(cors, {
  origin: '*', // o pon aquí tu URL de Vercel para restringirlo
});

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
    await fastify.listen({ port, host: '0.0.0.0' }); // importante para Render
    console.log(`Servidor en puerto ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
