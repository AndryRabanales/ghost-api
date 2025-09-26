const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');

const fastify = Fastify({ logger: true });

// CORS: permitir GET, POST, PATCH desde cualquier origen
fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
});

const prisma = new PrismaClient();

// ======================
// CREAR NUEVO CREATOR (DASHBOARD)
// ======================
fastify.post('/creators', async (req, reply) => {
  try {
    const { name } = req.body;
    const publicId = randomUUID();

    const creator = await prisma.creator.create({
      data: {
        name,
        publicId,
      },
    });

    // Links que se devuelven
    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
    const dashboardUrl = `${frontendBase}/dashboard/${creator.id}`;
    const publicUrl = `${frontendBase}/u/${creator.publicId}`;

    reply.code(201).send({
      dashboardUrl,
      publicUrl,
      creatorId: creator.id,
      publicId: creator.publicId,
    });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando creator' });
  }
});

// ======================
// CREAR MENSAJE (desde link público)
// ======================
fastify.post('/messages', async (req, reply) => {
  try {
    const { publicId, content, alias } = req.body;
    if (!publicId || !content) {
      return reply.code(400).send({ error: 'publicId y content son requeridos' });
    }

    // buscamos al Creator por publicId
    const creator = await prisma.creator.findUnique({ where: { publicId } });
    if (!creator) {
      return reply.code(404).send({ error: 'No existe creator con ese publicId' });
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

// ======================
// LISTAR MENSAJES FILTRANDO POR DASHBOARDID (creatorId)
// ======================
fastify.get('/messages', async (req, reply) => {
  try {
    const { dashboardId } = req.query;
    if (!dashboardId) {
      return reply.code(400).send({ error: 'dashboardId es requerido' });
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

// ======================
// ACTUALIZAR ESTADO DE MENSAJE (desbloquear)
// ======================
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

// ======================
// RUTA RAÍZ
// ======================
fastify.get('/', async (req, reply) => {
  reply.send({ status: 'API funcionando' });
});

// ======================
// DIAGNÓSTICO OPCIONAL
// ======================
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

// ======================
// INICIAR SERVIDOR
// ======================
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
