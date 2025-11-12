// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const { analyzeMessage } = require('../utils/aiAnalyzer');

// --- NUEVA FUNCIÓN: CALCULAR PRIORIDAD ---
// Esta es tu fórmula: y = x + (0.1*x^2)/1000
function calculatePriorityScore(amountInPesos) {
  if (amountInPesos <= 0) return 0;
  const x = amountInPesos;
  // Usamos Math.pow(x, 2) para x al cuadrado
  const score = x + (0.1 * Math.pow(x, 2) / 1000);
  // Redondeamos a 2 decimales por si acaso
  return Math.round(score * 100) / 100;
}
// --- FIN FUNCIÓN ---


// --- NUEVA FUNCIÓN UTILITARIA PARA MANEJAR EL LÍMITE DIARIO (S1) ---
async function checkAndResetLimit(creator) {
  const now = new Date();
  const lastReset = new Date(creator.msgCountLastReset);
  
  // Si han pasado más de 12 horas, resetea el contador (12 * 60 * 60 * 1000)
  if (now.getTime() - lastReset.getTime() >= 12 * 60 * 60 * 1000) { 
      creator = await prisma.creator.update({
          where: { id: creator.id },
          data: { 
              msgCountToday: 0,
              msgCountLastReset: now 
          }
      });
  }
  return creator;
}
// --- FIN DE LA FUNCIÓN UTILITARIA ---


async function publicRoutes(fastify, opts) {
  
  // --- Ruta para ENVIAR mensajes (AHORA OBLIGATORIAMENTE DE PAGO) ---
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const originalContent = req.body.content;
      const originalAlias = req.body.alias || "Anónimo";
      
      // El 'tipAmount' viene en PESOS (ej: 100, 150, 500)
      const tipAmount = req.body.tipAmount || 0; 
      
      // ... (Bloque de moderación de IA - Sin cambios) ...
      if (!originalContent || originalContent.trim().length < 3) {
        return reply.code(400).send({ error: "El mensaje es muy corto." });
      }
      try {
        const analysis = await analyzeMessage(originalContent);
        if (!analysis.isSafe) {
          return reply.code(400).send({ error: analysis.reason || 'Mensaje bloqueado por moderación.' });
        }
      } catch (aiError) {
        console.error("Error llamando a la IA (public):", aiError);
      }
      // --- FIN DEL BLOQUE ---

      const cleanContent = sanitize(originalContent);
      const cleanAlias = sanitize(originalAlias);

      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { 
            id: true, 
            name: true,
            // --- CAMBIO: Traemos el precio base del creador ---
            baseTipAmountCents: true, 
            dailyMsgLimit: true, 
            msgCountToday: true, 
            msgCountLastReset: true, 
            premiumContract: true 
        } 
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }
      
      // --- Lógica de Límite Diario (S1) - Sin cambios ---
      if (creator.dailyMsgLimit > 0) {
          creator = await checkAndResetLimit(creator); 
          if (tipAmount > 0 && creator.msgCountToday >= creator.dailyMsgLimit) {
              return reply.code(429).send({ 
                  error: "Este creador ha alcanzado su límite diario de mensajes premium. Intenta de nuevo mañana.",
                  code: "DAILY_LIMIT_REACHED"
              });
          }
      }

      // --- INICIO: NUEVA VALIDACIÓN DE PAGO MÍNIMO OBLIGATORIO ---
      // Convertimos el precio base de centavos a pesos para comparar
      const baseTipAmountPesos = (creator.baseTipAmountCents || 10000) / 100;

      if (tipAmount < baseTipAmountPesos) {
          return reply.code(400).send({ 
            error: `El pago mínimo para este creador es $${baseTipAmountPesos} MXN.`,
            code: "MINIMUM_PAYMENT_REQUIRED"
          });
      }
      // --- FIN: VALIDACIÓN DE PAGO MÍNIMO ---

      // --- CAMBIO: Ya no se necesita el 'tipOnlyMode' porque todos los mensajes son de pago ---

      const anonToken = crypto.randomUUID();

      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken,
          anonAlias: cleanAlias,
        },
      });

      // --- CAMBIO: Calcular el Puntaje de Prioridad ---
      const priorityScore = calculatePriorityScore(tipAmount);

      const message = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          alias: cleanAlias,
          content: cleanContent,
          tipAmount: tipAmount,
          tipStatus: 'PENDING', 
          tipPaymentIntentId: crypto.randomUUID(),
          // --- CAMBIO: Guardamos el puntaje ---
          priorityScore: priorityScore
        },
      });
      
      // AÑADIDO (S1): Incrementar el contador (ahora para todos los mensajes)
      if (creator.dailyMsgLimit > 0) {
          await prisma.creator.update({
              where: { id: creator.id },
              data: { msgCountToday: { increment: 1 } }
          });
      }

      fastify.broadcastToDashboard(creator.id, {
        type: 'message',
        ...message,
      });

      const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const chatUrl = `${baseUrl}/chats/${anonToken}/${chat.id}`;

      return reply.code(201).send({
        success: true,
        chatId: chat.id,
        anonToken,
        chatUrl,
        creatorName: creator.name,
        creatorPremiumContract: creator.premiumContract,
        message: {
          id: message.id,
          content: message.content,
          alias: message.alias,
          createdAt: message.createdAt,
        },
      });
    } catch (err) {
      fastify.log.error("❌ Error en /public/:publicId/messages:", err);
      return reply.code(500).send({ error: "Error enviando mensaje" });
    }
  });


  /**
   * RUTA AÑADIDA (S2): Obtener el contador de escasez (FOMO)
   * (Sin cambios, sigue siendo útil)
   */
  fastify.get("/public/:publicId/escasez", async (req, reply) => {
    try {
      const { publicId } = req.params;

      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { 
          id: true, 
          dailyMsgLimit: true,
          msgCountToday: true,
          msgCountLastReset: true 
        }
      });

      if (!creator) {
        return reply.send({
            dailyMsgLimit: 1000, 
            msgCountToday: 0,
            remainingSlots: 1000,
            resetTime: new Date(new Date().getTime() + 12 * 60 * 60 * 1000) 
        });
      }

      creator = await checkAndResetLimit(creator); 

      const remaining = Math.max(0, creator.dailyMsgLimit - creator.msgCountToday);
      const resetTime = new Date(new Date(creator.msgCountLastReset).getTime() + 12 * 60 * 60 * 1000);

      reply.send({
        dailyMsgLimit: creator.dailyMsgLimit,
        msgCountToday: creator.msgCountToday,
        remainingSlots: remaining,
        resetTime: resetTime
      });

    } catch (err) {
      fastify.log.error("❌ Error en /public/:publicId/escasez:", err);
      return reply.code(500).send({ error: "Error obteniendo datos de escasez" });
    }
  });
  

  /**
   * GET /public/creator/:publicId
   * Obtiene la info pública del creador (AHORA INCLUYE EL PRECIO BASE)
   */
  fastify.get("/public/creator/:publicId", async (req, reply) => {
    try {
      const { publicId } = req.params;

      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { 
          id: true, 
          name: true, 
          premiumContract: true,
          dailyMsgLimit: true,
          msgCountToday: true,
          msgCountLastReset: true,
          // --- CAMBIO: Devolver el precio base ---
          baseTipAmountCents: true 
        }
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      creator = await checkAndResetLimit(creator); 
      
      const isFull = (creator.dailyMsgLimit > 0) && (creator.msgCountToday >= creator.dailyMsgLimit);

      reply.send({
        creatorName: creator.name,
        premiumContract: creator.premiumContract,
        // --- CAMBIO: Devolvemos el precio base ---
        baseTipAmountCents: creator.baseTipAmountCents,
        escasezData: { 
          dailyMsgLimit: creator.dailyMsgLimit,
          msgCountToday: creator.msgCountToday,
        },
        isFull: isFull
      });

    } catch (err) {
      fastify.log.error("❌ Error en GET /public/creator/:publicId:", err);
      return reply.code(500).send({ error: "Error obteniendo información del creador" });
    }
  });

  // RUTA NECESARIA PARA QUE EL FRONTEND OBTENGA EL NOMBRE DEL CREADOR
  // (Sin cambios)
  fastify.get("/public/:publicId/info", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const creator = await prisma.creator.findUnique({ 
        where: { publicId },
        select: { 
          name: true, 
          lastActive: true 
        } 
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      reply.send({
        name: creator.name,
        lastActiveAt: creator.lastActive
      });
    } catch (err) {
      fastify.log.error("❌ Error en /public/:publicId/info:", err);
      return reply.code(500).send({ error: "Error obteniendo información del creador" });
    }
  });
}

module.exports = publicRoutes;