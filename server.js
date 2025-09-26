const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { PrismaClient } = require('@prisma/client');

const fastify = Fastify({ logger: true });

// 🔓 CORS: GET, POST, PATCH, OPTIONS
fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS']
});

const prisma = new PrismaClient();

// ======================
// MENSAJES
// ======================

// Crear un nuevo mensaje (alias opcional)
fastify.post('/messages', async (request, reply) => {
  try {
    const { content, userId, alias, creatorId } = request.body;
    if (!content || !creatorId) {
      return reply.code(400).send({ error: 'content y creatorId son requeridos' });
    }

    const message = await prisma.message.create({
      data: {
        content,
        userId,
        alias,
        creatorId, // guardamos el dueño del dashboard
      },
    });

    reply.code(201).send(message);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando mensaje' });
  }
});

// Listar mensajes (opcionalmente filtrando por creatorId)
fastify.get('/messages', async (req, reply) => {
  try {
    const { creatorId } = req.query;
    const where = creatorId ? { creatorId } : {};

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    reply.send(messages);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo mensajes' });
  }
});

// Actualizar estado de un mensaje (desbloquear)
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

// Diagnóstico: columnas de Message
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

start();
