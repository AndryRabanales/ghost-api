// utils/lives.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const REFILL_INTERVAL_MINUTES = 15;

async function refillLivesIfNeeded(creator) {
  if (!creator) return creator;
  if (creator.isPremium) return creator;

  const now = new Date();
  const diffMinutes = Math.floor((now - creator.lastUpdated) / (1000 * 60));
  if (diffMinutes < REFILL_INTERVAL_MINUTES || creator.lives >= creator.maxLives) {
    return creator;
  }

  const toAdd = Math.min(
    Math.floor(diffMinutes / REFILL_INTERVAL_MINUTES),
    creator.maxLives - creator.lives
  );

  const updated = await prisma.creator.update({
    where: { id: creator.id },
    data: {
      lives: creator.lives + toAdd,
      lastUpdated: now,
    },
  });

  return updated;
}

/**
 * Consume 1 vida de forma atómica.
 * - Refresca vidas si corresponde.
 * - Si es premium, no decrementa.
 * - Si no hay vidas, lanza un Error.
 */
async function consumeLife(creatorId) {
  // 1) obtener creator
  let creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!creator) throw new Error("Creator no encontrado");

  // 2) recalcular vidas si corresponde
  creator = await refillLivesIfNeeded(creator);

  if (creator.isPremium) {
    // premium = no consumir
    return creator;
  }

  if (creator.lives <= 0) {
    throw new Error("Sin vidas disponibles");
  }

  // 3) operación atómica: decrementar solo si lives > 0
  const updateResult = await prisma.creator.updateMany({
    where: { id: creatorId, lives: { gt: 0 }, isPremium: false },
    data: {
      lives: { decrement: 1 },
      lastUpdated: new Date(),
    },
  });

  if (updateResult.count === 0) {
    // otra petición consumió la última vida, o es premium
    // recargar creator para estado real y lanzar error
    creator = await prisma.creator.findUnique({ where: { id: creatorId } });
    if (creator.isPremium) return creator;
    throw new Error("Sin vidas disponibles (concurrency)");
  }

  // 4) traer el creator actualizado
  creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  return creator;
}

function minutesToNextLife(creator) {
  if (!creator || creator.isPremium) return 0;
  if (creator.lives >= creator.maxLives) return 0;

  const lastUpdated = creator.lastUpdated || new Date();
  const now = new Date();
  const diffMinutes = Math.floor((now - lastUpdated) / (1000 * 60));
  const remain = REFILL_INTERVAL_MINUTES - (diffMinutes % REFILL_INTERVAL_MINUTES);
  return remain > 0 ? remain : 0;
}

module.exports = { REFILL_INTERVAL_MINUTES, refillLivesIfNeeded, consumeLife, minutesToNextLife };
