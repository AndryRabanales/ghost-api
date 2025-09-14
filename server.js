const Fastify = require('fastify');
const cors = require('@fastify/cors'); // 👈 importa cors
const { PrismaClient } = require('@prisma/client');

const fastify = Fastify({ logger: true });

// 👇 registra CORS para que tu frontend en Vercel pueda consumirlo
// Puedes poner origin: '*' o la URL exacta de tu frontend:
await fastify.register(cors, {
  origin: 'https://ghost-web-git-main-andryrabanales-projects.vercel.app', 
});

// Prisma
const prisma = new PrismaClient();

// Ruta POST para guardar mensajes
fastify.post('/messages', async (request, reply) => {
  const { content, userId } = request.body;
  const message = await prisma.message.create({
    data: { content, userId }
  });
  reply.code(201).send(message);
});

// Ruta GET para listar mensajes
fastify.get('/messages', async (request, reply) => {
  const messages = await prisma.message.findMany({
    orderBy: { createdAt: 'desc' }
  });
  reply.send(messages);
});

// Arrancar servidor
const start = async () => {
  try {
    const port = process.env.PORT || 3001;
    await fastify.listen({ port, host: '0.0.0.0' }); // 👈 importante para Render
    console.log(`Servidor en puerto ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
