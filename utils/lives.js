const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Cada cuánto se regenera una vida (en minutos)
const REFILL_INTERVAL_MINUTES = 15;

/**
 * Recalcula las vidas de un creador según el tiempo transcurrido
 * @param {Object} creator - objeto creator desde la base de datos
 * @returns {Promise<Object>} - creator actualizado
 */
async function refillLives(creator) {
  if (creator.isPremium) return creator; // Premium tiene vidas infinitas

  let lives = creator.lives ?? creator.maxLives;
  let lastUpdated = creator.lastUpdated || new Date(0);

  const now = new Date();
  const diffMinutes = Math.floor((now - lastUpdated) / (1000 * 60));

  if (diffMinutes >= REFILL_INTERVAL_MINUTES && lives < creator.maxLives) {
    // cuántas vidas regenerar
    const toAdd = Math.min(
      Math.floor(diffMinutes / REFILL_INTERVAL_MINUTES),
      creator.maxLives - lives
    );
    lives += toAdd;
    lastUpdated = now;

    creator = await prisma.creator.update({
      where: { id: creator.id },
      data: { lives, lastUpdated },
    });
  }

  return creator;
}

/**
 * Consume 1 vida si está disponible
 * @param {String} creatorId
 * @returns {Promise<Object>} - creator actualizado o error si no tiene vidas
 */
async function consumeLife(creatorId) {
  let creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!creator) throw new Error("Creator no encontrado");

  creator = await refillLives(creator);

  if (!creator.isPremium && creator.lives <= 0) {
    throw new Error("Sin vidas disponibles, espera 15 min o compra Premium");
  }

  if (!creator.isPremium) {
    creator = await prisma.creator.update({
      where: { id: creatorId },
      data: {
        lives: { decrement: 1 },
        lastUpdated: new Date(),
      },
    });
  }

  return creator;
}

/**
 * Devuelve cuánto falta para la próxima vida
 * @param {Object} creator
 * @returns {Number} minutos restantes
 */
function minutesToNextLife(creator) {
  if (creator.isPremium) return 0;

  if (creator.lives >= creator.maxLives) return 0;

  const lastUpdated = creator.lastUpdated || new Date();
  const now = new Date();
  const diffMinutes = Math.floor((now - lastUpdated) / (1000 * 60));

  const remaining = REFILL_INTERVAL_MINUTES - (diffMinutes % REFILL_INTERVAL_MINUTES);
  return remaining > 0 ? remaining : 0;
}

module.exports = {
  REFILL_INTERVAL_MINUTES,
  refillLives,
  consumeLife,
  minutesToNextLife,
};
