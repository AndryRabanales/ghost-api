// utils/lives.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Vidas máximas que puede tener un usuario normal
const MAX_LIVES = 5;

// Cada cuánto se regenera una vida (en minutos)
const REFILL_INTERVAL_MINUTES = 15;

/**
 * Recalcula las vidas de un creador según el tiempo transcurrido
 * @param {Object} creator - objeto creator desde la base de datos
 * @returns {Promise<Object>} - creator actualizado
 */
async function refillLives(creator) {
  if (creator.isPremium) return creator; // Premium tiene vidas infinitas

  let lives = creator.lives ?? MAX_LIVES;
  let lastRefillAt = creator.lastRefillAt || new Date(0);

  const now = new Date();
  const diffMinutes = Math.floor((now - lastRefillAt) / (1000 * 60));

  if (diffMinutes >= REFILL_INTERVAL_MINUTES && lives < MAX_LIVES) {
    // cuántas vidas regenerar
    const toAdd = Math.min(
      Math.floor(diffMinutes / REFILL_INTERVAL_MINUTES),
      MAX_LIVES - lives
    );
    lives += toAdd;
    lastRefillAt = now;

    creator = await prisma.creator.update({
      where: { id: creator.id },
      data: { lives, lastRefillAt },
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
      data: { lives: { decrement: 1 } },
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

  if (creator.lives >= MAX_LIVES) return 0;

  const lastRefillAt = creator.lastRefillAt || new Date();
  const now = new Date();
  const diffMinutes = Math.floor((now - lastRefillAt) / (1000 * 60));

  const remaining = REFILL_INTERVAL_MINUTES - (diffMinutes % REFILL_INTERVAL_MINUTES);
  return remaining > 0 ? remaining : 0;
}

module.exports = {
  MAX_LIVES,
  REFILL_INTERVAL_MINUTES,
  refillLives,
  consumeLife,
  minutesToNextLife,
};
