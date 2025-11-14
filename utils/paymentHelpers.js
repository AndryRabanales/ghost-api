// Contenido para: andryrabanales/ghost-api/ghost-api-e1322b6d8cb4a19aa105871a038f33f8393d703e/utils/paymentHelpers.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * (S6) Calcula el puntaje de prioridad base basado en el monto.
 * Fórmula: y = x + (0.1*x^2)/1000
 * @param {number} amountInPesos - El monto pagado (ej: 100).
 * @returns {number} El puntaje de prioridad base.
 */
function calculatePriorityScore(amountInPesos) {
  if (amountInPesos <= 0) return 0;
  const x = amountInPesos;
  // Usamos Math.pow(x, 2) para x al cuadrado
  const score = x + (0.1 * Math.pow(x, 2) / 1000);
  // Redondeamos a 2 decimales
  return Math.round(score * 100) / 100;
}

/**
 * (S1) Revisa si el contador de límite diario debe reiniciarse.
 * @param {object} creator - El objeto Creador de Prisma.
 * @returns {Promise<object>} El objeto Creador (actualizado si fue reseteado).
 */
async function checkAndResetLimit(creator) {
  const now = new Date();
  const lastReset = new Date(creator.msgCountLastReset);
  
  // Resetea si han pasado más de 12 horas
  const RESET_HOURS = 12 * 60 * 60 * 1000; 
  
  if (now.getTime() - lastReset.getTime() >= RESET_HOURS) { 
      fastify.log.info(`Reseteando contador para creator ${creator.id}`);
      return prisma.creator.update({
          where: { id: creator.id },
          data: { 
              msgCountToday: 0,
              msgCountLastReset: now 
          }
      });
  }
  return creator;
}

module.exports = {
    calculatePriorityScore,
    checkAndResetLimit
}