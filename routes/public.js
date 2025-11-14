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
 // routes/public.js (Actualización de la ruta principal de envío de mensajes)

// Asegúrate de que las dependencias necesarias estén importadas:
// const { analyzeMessage } = require('../utils/aiAnalyzer'); 
// const { sanitize } = require("../utils/sanitize"); 
// const { calculatePriorityScore, checkAndResetLimit } = (funciones utilitarias)

fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const originalContent = req.body.content;
      const originalAlias = req.body.alias || "Anónimo";
      
      // El 'tipAmount' viene en PESOS (ej: 100, 150, 500)
      const tipAmount = req.body.tipAmount || 0; 
      
      if (!originalContent || originalContent.trim().length < 3) {
        return reply.code(400).send({ error: "El mensaje es muy corto." });
      }
      
      const cleanContent = sanitize(originalContent);
      const cleanAlias = sanitize(originalAlias);

      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { 
            id: true, 
            name: true,
            baseTipAmountCents: true, 
            dailyMsgLimit: true, 
            msgCountToday: true, 
            msgCountLastReset: true, 
            premiumContract: true,
            topicPreference: true // <-- CLAVE: Traemos la preferencia de tema (E4)
        } 
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }
      
      // --- Lógica de Límite Diario (S1) ---
      if (creator.dailyMsgLimit > 0) {
          creator = await checkAndResetLimit(creator); 
          if (tipAmount > 0 && creator.msgCountToday >= creator.dailyMsgLimit) {
              return reply.code(429).send({ 
                  error: "Este creador ha alcanzado su límite diario de mensajes premium. Intenta de nuevo mañana.",
                  code: "DAILY_LIMIT_REACHED"
              });
          }
      }

      // --- VALIDACIÓN DE PAGO MÍNIMO OBLIGATORIO (P2) ---
      const baseTipAmountPesos = (creator.baseTipAmountCents || 10000) / 100;

      if (tipAmount < baseTipAmountPesos) {
          return reply.code(400).send({ 
            error: `El pago mínimo para este creador es $${baseTipAmountPesos} MXN.`,
            code: "MINIMUM_PAYMENT_REQUIRED"
          });
      }
      // --- FIN: VALIDACIÓN DE PAGO MÍNIMO ---


      // --- INICIO: DOBLE MODERACIÓN Y CALCULO DE PRIORIDAD (E1, E4) ---
      let priorityScoreBase = calculatePriorityScore(tipAmount); // Score base solo por el monto
      let finalPriorityScore = priorityScoreBase;
      let relevanceScore = 5; // Valor neutro por defecto (por si la IA falla)

     // ... (dentro de POST /public/:publicId/messages)
     try {
      // LLAMADA CLAVE: Se hace la doble verificación de Seguridad y Relevancia
      const analysis = await analyzeMessage(cleanContent, creator.topicPreference);
      
      // 1. Verificación de Seguridad (El Policía - E1)
      if (!analysis.isSafe) {
          return reply.code(400).send({ error: analysis.reason || 'Mensaje bloqueado por moderación.' });
      }
      
      // 2. Cálculo de Relevancia (E4)
      relevanceScore = analysis.relevance;

      // --- 👇 INICIO DEL NUEVO BLOQUE DE RECHAZO POR RELEVANCIA 👇 ---
      // Si el creador definió un tema, hacemos cumplir la regla.
      const MINIMUM_RELEVANCE_SCORE = 3; // Umbral (de 1 a 10). 3 es un buen inicio.

      if (creator.topicPreference && relevanceScore < MINIMUM_RELEVANCE_SCORE) {
        fastify.log.warn(`[Relevance Block] Mensaje bloqueado. Score: ${relevanceScore} (Mínimo: ${MINIMUM_RELEVANCE_SCORE}). Tema: "${creator.topicPreference}"`);
        return reply.code(400).send({ 
          error: `El mensaje no parece estar relacionado con el tema del creador (${creator.topicPreference}). Por favor, ajusta tu pregunta.`,
          code: "MESSAGE_NOT_RELEVANT" // Código de error para el frontend
        });
      }
      // --- 👆 FIN DEL NUEVO BLOQUE 👆 ---
      
      // Aplicar BONUS/PENALIZACIÓN a la Prioridad por Relevancia
      // Fórmula: ScoreFinal = Base * (1 + (Relevancia - 5) / 10)
      const relevanceFactor = 1 + (relevanceScore - 5) / 10;
      finalPriorityScore = Math.round(priorityScoreBase * relevanceFactor * 100) / 100;
// ... (continúa)
          fastify.log.info(`✅ Score base: ${priorityScoreBase}, Relevancia: ${relevanceScore}, Final Score: ${finalPriorityScore}`);

      } catch (aiError) {
          fastify.log.error("❌ Error grave en AI Analyzer:", aiError);
          // Si la IA falla, usamos el score base y relevancia neutral (5).
          relevanceScore = 5; 
          finalPriorityScore = priorityScoreBase;
      }
      // --- FIN: DOBLE MODERACIÓN Y CALCULO DE PRIORIDAD ---

      
      const anonToken = crypto.randomUUID();

      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken,
          anonAlias: cleanAlias,
        },
      });

      // --- CREACIÓN DEL MENSAJE FINAL (Escrow Blando y Scoring) ---
      const message = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          alias: cleanAlias,
          content: cleanContent,
          tipAmount: tipAmount,
          tipStatus: 'PENDING', // <--- CLAVE: ESCROW BLANDO
          tipPaymentIntentId: crypto.randomUUID(),
          priorityScore: finalPriorityScore, // <--- GUARDAMOS EL SCORE FINAL (S6)
          relevanceScore: relevanceScore // <--- GUARDAMOS LA RELEVANCIA (E4)
        },
      });
      
      // (S1): Incrementar el contador
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

// ... (El resto de las rutas del archivo public.js) ...

  


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