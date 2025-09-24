const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { PrismaClient } = require('@prisma/client');

const fastify = Fastify({ logger: true });
fastify.register(cors, { origin: '*' });

const prisma = new PrismaClient();

/* ======================
   RONDAS
   ====================== */

// Crear una nueva ronda
fastify.post('/rounds', async (request, reply) => {
  try {
    const { creatorId } = request.body;
    if (!creatorId) {
      return reply.code(400).send({ error: 'creatorId es requerido' });
    }
    const round = await prisma.round.create({ data: { creatorId } });
    reply.code(201).send(round);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando ronda' });
  }
});

// Obtener la ronda actual del día (si no existe, crearla automáticamente)
fastify.get('/rounds/current/:creatorId', async (request, reply) => {
  try {
    const { creatorId } = request.params;
    if (!creatorId) {
      return reply.code(400).send({ error: 'creatorId es requerido' });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let round = await prisma.round.findFirst({
      where: { creatorId, date: { gte: startOfDay } },
      orderBy: { date: 'desc' },
    });

    if (!round) {
      round = await prisma.round.create({ data: { creatorId } });
    }

    reply.send(round);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo ronda actual' });
  }
});

/* ======================
   MENSAJES
   ====================== */

// Crear un mensaje dentro de una ronda
fastify.post('/messages', async (request, reply) => {
  try {
    const { content, userId, roundId } = request.body;
    if (!content || !roundId) {
      return reply.code(400).send({ error: 'content y roundId son requeridos' });
    }
    const message = await prisma.message.create({
      data: { content, userId, roundId },
    });
    reply.code(201).send(message);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error creando mensaje' });
  }
});

// Listar mensajes de una ronda (visibles + bloqueados)
fastify.get('/messages/:roundId', async (req, reply) => {
  try {
    const { roundId } = req.params;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const visible = await prisma.message.findMany({
      where: { roundId, createdAt: { lte: cutoff } },
      orderBy: { createdAt: 'desc' },
    });

    const locked = await prisma.message.findMany({
      where: { roundId, createdAt: { gt: cutoff } },
      orderBy: { createdAt: 'desc' },
    });

    reply.send({ visible, locked });
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error obteniendo mensajes' });
  }
});

// Marcar predicción como cumplida o no cumplida
fastify.patch('/messages/:id', async (request, reply) => {
  try {
    const { status } = request.body;
    if (!['FULFILLED', 'NOT_FULFILLED'].includes(status)) {
      return reply.code(400).send({ error: 'Estado inválido' });
    }
    const message = await prisma.message.update({
      where: { id: request.params.id },
      data: { seen: true, status },
    });
    reply.send(message);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: err.message || 'Error actualizando mensaje' });
  }
});

/* ======================
   ARRANQUE DEL SERVIDOR
   ====================== */

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
