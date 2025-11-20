const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Filtro rápido y gratis para insultos graves
const LOCAL_BAD_WORDS = [
  'idiota', 'imbécil', 'estúpido', 'estupido', 'muérete', 'muerete', 'suicídate',
  'puta', 'puto', 'zorra', 'perra', 'naco', 'gordo', 'gorda', 'asco',
  'te voy a matar', 'te voy a buscar', 'te voy a encontrar'
];

const analyzeMessage = async (content, creatorPreference) => {
  const lowerCaseContent = content.toLowerCase();

  // 1. Filtro Local (Palabras prohibidas)
  for (const word of LOCAL_BAD_WORDS) {
    if (lowerCaseContent.includes(word)) {
      return { isSafe: false, reason: 'Tu mensaje contiene lenguaje ofensivo prohibido.' };
    }
  }

  // 2. Moderación OpenAI (Gratis - Capa de seguridad extra)
  try {
    const modResponse = await openai.moderations.create({ input: content });
    if (modResponse.results[0].flagged) {
      return { isSafe: false, reason: 'Tu mensaje infringe las normas de seguridad.' };
    }
  } catch (modError) {
    console.error("Error moderación:", modError);
  }

  // 3. Análisis de Contexto (GPT) - MODALIDAD ESTRICTA
  const preference = creatorPreference && creatorPreference.trim() !== "" 
    ? creatorPreference 
    : "Cualquier tema"; // Si no hay preferencia, acepta todo.

  // Prompt diseñado para bloquear si el tema no coincide
  const prompt = `
  Actúa como un moderador estricto.
  
  El creador ha establecido este TEMA OBLIGATORIO: "${preference}".
  
  Analiza el mensaje del usuario: "${content}"

  Reglas:
  1. Si el mensaje es ofensivo o peligroso, marca safety="UNSAFE".
  2. Si el mensaje NO tiene relación con el tema "${preference}", marca safety="OFF_TOPIC".
  3. Si el mensaje cumple con el tema, marca safety="SAFE".

  Responde SOLO en formato JSON:
  {"safety": "SAFE" | "UNSAFE" | "OFF_TOPIC", "reason_es": "Explicación muy breve para el usuario en español"}
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-0125", // Modelo rápido y económico
      messages: [{ role: "system", content: prompt }],
      max_tokens: 120,
      temperature: 0, // Temperatura 0 para máxima objetividad
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log(`[AI Check] Tema: "${preference}" | Estado: ${result.safety} | Razón: ${result.reason_es}`);

    // BLOQUEO 1: Seguridad
    if (result.safety === 'UNSAFE') {
      return { isSafe: false, reason: result.reason_es || 'Mensaje bloqueado por seguridad.' };
    }

    // BLOQUEO 2: Tema Incorrecto (ESTO ES LO QUE FALTABA)
    if (result.safety === 'OFF_TOPIC') {
      return { isSafe: false, reason: result.reason_es || `Por favor, apégate al tema: ${preference}` };
    }

    // Aprobado
    return { isSafe: true, relevance: 10 };

  } catch (error) {
    console.error("Error AI (Etapa 3):", error);
    // Fallback: Si la IA falla técnicamente, permitimos el mensaje para no perder la venta
    return { isSafe: true, relevance: 5 }; 
  }
};

/**
 * Auditoría de respuestas del creador (Permisiva por ahora)
 */
async function analyzeCreatorResponse(responseContent) {
    return { success: true, reason: "Aprobado" };
}

module.exports = { 
  analyzeMessage,
  analyzeCreatorResponse
};