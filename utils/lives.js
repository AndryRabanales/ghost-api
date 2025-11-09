// andryrabanales/ghost-api/ghost-api-ccf8c4209b8106a049818e3cd23d69e44883da4e/utils/lives.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const REFILL_INTERVAL_MINUTES = 30;

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
 * * MODIFICADO: 
 * - Si es Premium, no se decrementa (beneficio Premium).
 * - Si es GRATUITO, no se consume vida (funcionalidad base ILIMITADA).
 */
async function consumeLife(creatorId) {
  // 1) obtener creator
  let creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!creator) throw new Error("Creator no encontrado");

  // 2) recalcular vidas si corresponde (Solo para actualizar lastUpdated si fuera necesario)
  creator = await refillLivesIfNeeded(creator);

  // IMPLEMENTACIÓN CLAVE: Si no es Premium, se devuelve inmediatamente.
  if (!creator.isPremium) {
    // Usuario GRATUITO: Vidas Ilimitadas por defecto (Pilar 1).
    return creator; 
  }
  
  // Si llega aquí y es Premium, el refillLivesIfNeeded ya se ejecutó al inicio.
  return creator;
}

function minutesToNextLife(creator) {
  // Ya que todos son ilimitados (a menos que reintroduzcamos el límite), 
  // este valor será siempre 0 para los no-Premium.
  if (!creator || creator.isPremium) return 0; 
  if (creator.lives >= creator.maxLives) return 0;

  const lastUpdated = creator.lastUpdated || new Date();
  const now = new Date();
  const diffMinutes = Math.floor((now - lastUpdated) / (1000 * 60));
  const remain = REFILL_INTERVAL_MINUTES - (diffMinutes % REFILL_INTERVAL_MINUTES);
  return remain > 0 ? remain : 0;
}

module.exports = { REFILL_INTERVAL_MINUTES, refillLivesIfNeeded, consumeLife, minutesToNextLife };