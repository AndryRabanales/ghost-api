const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { PrismaClient } = require('@prisma/client');

const fastify = Fastify({ logger: true });
fastify.register(cors, { origin: '*' });

const prisma = new PrismaClient();

// ======================
// MENSAJES
// ======================

// Crear un nuevo mensaje (alias opcional, sin roundId)
fastify.post('/messages', async (request, reply) => {
  try {
    const { content, userId, alias } = request.body;
    if (!content) {
      return reply.code(400).send({ error: 'El campo content es requerido' });
    }

    const message = await prisma.message.create({
      data: {
        content,
        userId,
        alias, // 👈 guardamos alias
      },
    });

    reply.code(201).send(message);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando mensaje' });
  }
});

// Listar todos los mensajes
fastify.get('/messages', async (req, reply) => {
  try {
    const messages = await prisma.message.findMany({
      orderBy: { createdAt: 'desc' },
    });
    reply.send(messages);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo mensajes' });
  }
});

// Actualizar estado de un mensaje
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

// Ruta raíz opcional
fastify.get('/', async (req, reply) => {
  reply.send({ status: 'API funcionando' });
});

// Iniciar servidor
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3001, host: '0.0.0.0' });
    console.log(`Servidor en puerto ${process.env.PORT || 3001}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

fastify.get('/__diag', async (req, reply) => {
  try {
    const cols = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Message' 
      ORDER BY 1
    `;
    const clientVersion = require('@prisma/client/package.json').version;
    reply.send({ prismaClientVersion: clientVersion, messageColumns: cols });
  } catch (e) {
    reply.code(500).send({ error: e.message });
  }
});

start();
