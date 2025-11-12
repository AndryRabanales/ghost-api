// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const { analyzeMessage } = require('../utils/aiAnalyzer');

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
  const MIN_PREMIUM_AMOUNT = 100; // <-- AÑADIDO (P1: Precio Mínimo)

  // --- Ruta existente para ENVIAR mensajes ---
  fastify.post("/public/:publicId/messages", async (req, reply) => {
    try {
      const { publicId } = req.params;
      const originalContent = req.body.content;
      const originalAlias = req.body.alias || "Anónimo";
      
      // AÑADIDO: Recibir tipAmount del body (simulado)
      const tipAmount = req.body.tipAmount || 0; 
      
      // ... (Bloque de moderación de IA) ...
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

      let creator = await prisma.creator.findUnique({ // Cambiado de const a let para actualizarlo
        where: { publicId },
        select: { 
            id: true, 
            name: true, 
            tipOnlyMode: true,
            dailyMsgLimit: true, // S1: Incluir el límite
            msgCountToday: true, // S1: Incluir el contador
            msgCountLastReset: true, // S1: Incluir la fecha de reset
            premiumContract: true // S3: Incluir el contrato
        } 
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }
      
      // --- INICIO: Lógica de Límite Diario (S1) ---
      if (creator.dailyMsgLimit > 0) {
          // 1. Verificar y resetear el contador si es necesario
          creator = await checkAndResetLimit(creator); 
          
          // 2. Verificar el límite
          if (tipAmount > 0 && creator.msgCountToday >= creator.dailyMsgLimit) {
              return reply.code(429).send({ // 429 Too Many Requests
                  error: "Este creador ha alcanzado su límite diario de mensajes premium. Intenta de nuevo mañana.",
                  code: "DAILY_LIMIT_REACHED"
              });
          }
      }
      // --- FIN: Lógica de Límite Diario ---


      // --- INICIO: VALIDACIÓN DE PAGO MÍNIMO (P1) ---
      if (tipAmount > 0 && tipAmount < MIN_PREMIUM_AMOUNT) {
          // Error de cliente si intenta pagar un monto insuficiente
          return reply.code(400).send({ 
            error: `El monto mínimo por respuesta premium es $${MIN_PREMIUM_AMOUNT} MXN.`,
          });
      }
      // --- FIN: VALIDACIÓN DE PAGO MÍNIMO ---

      // IMPLEMENTACIÓN PILAR 3: MODO SOLO PROPINAS
      if (creator.tipOnlyMode && (!tipAmount || tipAmount <= 0)) {
        return reply.code(403).send({ 
          error: "Este creador solo acepta mensajes con propina adjunta. ¡Hazte Pro!",
          code: "TIP_ONLY_MODE"
        });
      }

      const anonToken = crypto.randomUUID();

      const chat = await prisma.chat.create({
        data: {
          creatorId: creator.id,
          anonToken,
          anonAlias: cleanAlias,
        },
      });

      const message = await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          from: "anon",
          alias: cleanAlias,
          content: cleanContent,
          // PILAR 2: REGISTRO DE PROPINA (Simulado)
          tipAmount: tipAmount > 0 ? tipAmount : null,
          tipStatus: tipAmount > 0 ? 'PENDING' : null, // Status PENDING si hay monto
          tipPaymentIntentId: tipAmount > 0 ? crypto.randomUUID() : null, // ID de pago simulado
        },
      });
      
      // AÑADIDO (S1): Si hay propina, incrementar el contador
      if (tipAmount > 0 && creator.dailyMsgLimit > 0) {
          await prisma.creator.update({
              where: { id: creator.id },
              data: { msgCountToday: { increment: 1 } }
          });
      }
      // --- FIN S1 INCREMENTO ---


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
        // --- AÑADIDO: Devolver el contrato al crear el chat ---
        creatorPremiumContract: creator.premiumContract,
        // --- FIN AÑADIDO ---
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
        // Devolvemos 200 con límite alto si no hay creador para no romper el frontend
        return reply.send({
            dailyMsgLimit: 1000, 
            msgCountToday: 0,
            remainingSlots: 1000,
            resetTime: new Date(new Date().getTime() + 12 * 60 * 60 * 1000) 
        });
      }

      // Asegurar que el contador esté actualizado
      creator = await checkAndResetLimit(creator); 

      const remaining = Math.max(0, creator.dailyMsgLimit - creator.msgCountToday);
      const resetTime = new Date(new Date(creator.msgCountLastReset).getTime() + 12 * 60 * 60 * 1000);

      reply.send({
        dailyMsgLimit: creator.dailyMsgLimit,
        msgCountToday: creator.msgCountToday,
        remainingSlots: remaining, // S2: Lugares restantes
        resetTime: resetTime // Hora de reseteo
      });

    } catch (err) {
      fastify.log.error("❌ Error en /public/:publicId/escasez:", err);
      return reply.code(500).send({ error: "Error obteniendo datos de escasez" });
    }
  });
  

  // --- 👇 ESTA ES LA RUTA NUEVA Y CLAVE ---
  /**
   * GET /public/creator/:publicId
   * Obtiene la info pública del creador (nombre, contrato, límites)
   * ANTES de que se envíe el primer mensaje.
   */
  fastify.get("/public/creator/:publicId", async (req, reply) => {
    try {
      const { publicId } = req.params;

      let creator = await prisma.creator.findUnique({
        where: { publicId },
        select: { 
          id: true, // Necesario para checkAndResetLimit
          name: true, 
          premiumContract: true,
          dailyMsgLimit: true,
          msgCountToday: true,
          msgCountLastReset: true 
        }
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

      // Reutilizar la lógica de reseteo de límite si es necesario
      creator = await checkAndResetLimit(creator); 
      
      const isFull = (creator.dailyMsgLimit > 0) && (creator.msgCountToday >= creator.dailyMsgLimit);

      // Devolvemos la info pública que el frontend necesita
      reply.send({
        creatorName: creator.name,
        premiumContract: creator.premiumContract,
        escasezData: { // Devolvemos el objeto que el frontend espera
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
  // --- 👆 FIN DE LA NUEVA RUTA ---


  // RUTA NECESARIA PARA QUE EL FRONTEND OBTENGA EL NOMBRE DEL CREADOR
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