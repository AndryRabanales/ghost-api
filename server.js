const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { PrismaClient } = require('@prisma/client');

const fastify = Fastify({ logger: true });

fastify.register(cors, {
  origin: '*', // en producción pon aquí tu dominio frontend
});

const prisma = new PrismaClient();

/* 
  ======================
  RONDAS
  ======================
*/

// Crear una nueva ronda manualmente (por ejemplo cada día)
fastify.post('/rounds', async (request, reply) => {
  try {
    const { creatorId } = request.body; // quien la abre (tu usuario)
    const round = await prisma.round.create({
      data: { creatorId },
    });
    reply.code(201).send(round);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: 'Error creando ronda' });
  }
});

// Obtener todas las rondas
fastify.get('/rounds', async (request, reply) => {
  const rounds = await prisma.round.findMany({
    orderBy: { date: 'desc' },
  });
  reply.send(rounds);
});

// 🔹 Obtener la ronda actual del día (si no existe, crearla automáticamente)
fastify.get('/rounds/current/:creatorId', async (request, reply) => {
  const { creatorId } = request.params;

  // Calcular inicio del día actual
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Buscar ronda activa de hoy para ese creatorId
  let round = await prisma.round.findFirst({
    where: {
      creatorId,
      date: {
        gte: startOfDay, // ronda creada hoy
      },
    },
    orderBy: { date: 'desc' },
  });

  // Si no existe, crearla automáticamente
  if (!round) {
    round = await prisma.round.create({
      data: { creatorId },
    });
  }

  reply.send(round);
});

/* 
  ======================
  MENSAJES
  ======================
*/

// Crear un mensaje dentro de una ronda
fastify.post('/messages', async (request, reply) => {
  try {
    const { content, userId, roundId } = request.body; // ahora necesitas pasar roundId
    const message = await prisma.message.create({
      data: { content, userId, roundId },
    });
    reply.code(201).send(message);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: 'Error creando mensaje' });
  }
});

// Contar mensajes bloqueados (últimas 24h)
fastify.get('/messages/count', async (request, reply) => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const locked = await prisma.message.count({
    where: { createdAt: { gt: cutoff } },
  });
  reply.send({ locked });
});

// Listar mensajes de una ronda
fastify.get('/messages/:roundId', async (request, reply) => {
  const { roundId } = request.params;
  const messages = await prisma.message.findMany({
    where: { roundId },
    orderBy: { createdAt: 'desc' },
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
      status,
    },
  });
  reply.send(message);
});

/* 
  ======================
  ARRANQUE DEL SERVIDOR
  ======================
*/

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
