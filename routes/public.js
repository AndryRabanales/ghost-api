// routes/public.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { sanitize } = require("../utils/sanitize");
const { analyzeMessage } = require('../utils/aiAnalyzer');

async function publicRoutes(fastify, opts) {

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

      const creator = await prisma.creator.findUnique({ 
        where: { publicId },
        select: { id: true, name: true, tipOnlyMode: true } 
      });

      if (!creator) {
        return reply.code(404).send({ error: "Creador no encontrado" });
      }

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

  // ... (el resto de las rutas públicas se mantienen) ...
}

module.exports = publicRoutes;