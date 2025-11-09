const { OpenAI } = require("openai");

// 1. Carga la clave API de OpenAI desde el archivo .env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- ETAPA 1 (Costo: $0) ---
// Filtro de insultos obvios y directos.
// NO ponemos groserías casuales (ej. "pendejo", "no mames")
const LOCAL_BAD_WORDS = [
  'idiota', 'imbécil', 'estúpido', 'estupido', 'muérete', 'muerete', 'suicídate',
  'puta', 'puto', 'zorra', 'perra', 'naco', 'gordo', 'gorda', 'asco',
  'te voy a matar', 'te voy a buscar', 'te voy a encontrar'
];

/**
 * La estrategia de 3 etapas para analizar mensajes.
 * Etapa 1: Filtro local de palabras (Gratis)
 * Etapa 2: Modelo de Moderación de OpenAI (Gratis)
 * Etapa 3: Modelo de Contexto GPT-4o-mini (De Pago)
 */
const analyzeMessage = async (content) => {
  const lowerCaseContent = content.toLowerCase();

  // --- ETAPA 1: Filtro de Palabras Clave (Costo: $0) ---
  for (const word of LOCAL_BAD_WORDS) {
    if (lowerCaseContent.includes(word)) {
      console.log(`[AI Moderation - ETAPA 1] Mensaje BLOQUEADO (Palabra clave): ${word}`);
      return { isSafe: false, reason: 'Tu mensaje fue bloqueado por moderación.' };
    }
  }

  // --- ETAPA 2: Modelo de Moderación GRATUITO (Costo: $0) ---
  try {
    const modResponse = await openai.moderations.create({
      input: content,
    });
    
    if (modResponse.results[0].flagged) {
      console.log(`[AI Moderation - ETAPA 2] Mensaje BLOQUEADO (Moderación Gratuita)`);
      return { isSafe: false, reason: 'Tu mensaje fue bloqueado por moderación.' };
    }
  } catch (modError) {
    console.error("ERROR en AI Analyzer (Etapa 2 - Moderación Gratuita):", modError);
    // Si la Etapa 2 falla, no lo bloqueamos, lo pasamos a la Etapa 3 por si acaso.
  }

  // --- ETAPA 3: "Detective" de Contexto (Costo: $ PAGO) ---
  // Solo se ejecuta si el mensaje pasa las dos etapas gratuitas.
  // Es para mensajes como "Qué guapa te ves, dime dónde vives"
  const prompt = `
    Analiza el siguiente mensaje. Tu única tarea es clasificarlo como 'SAFE' (seguro) o 'UNSAFE' (inseguro).
    Considera 'UNSAFE' CUALQUIER insinuación sexual, pregunta personal sospechosa, o acoso sutil.
    Responde ÚNICAMENTE con la palabra 'SAFE' o la palabra 'UNSAFE'.

    Mensaje: "${content}"
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // El modelo que SÍ funcionó en nuestras pruebas
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: content }
      ],
      max_tokens: 5,
      temperature: 0, // Crítico para que solo responda "SAFE" o "UNSAFE"
    });

    const text = response.choices[0].message.content.trim().toUpperCase();

    if (text === 'UNSAFE') {
      console.log(`[AI Moderation - ETAPA 3] Mensaje BLOQUEADO (GPT-4o-mini): ${content.substring(0, 30)}...`);
      return { isSafe: false, reason: 'Tu mensaje fue bloqueado por moderación.' };
    }

    console.log(`[AI Moderation - ETAPA 3] Mensaje APROBADO (GPT-4o-mini)`);
    return { isSafe: true };

  } catch (error) {
    console.error("ERROR en AI Analyzer (Etapa 3 - GPT-4o-mini):", error);
    // Si la IA de pago falla, lo dejamos pasar por ahora.
    return { isSafe: true }; 
  }
};

module.exports = { analyzeMessage };