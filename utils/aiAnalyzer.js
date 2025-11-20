const { OpenAI } = require("openai");

// 1. Carga la clave API de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- ETAPA 1 (Costo: $0) ---
// Filtro de insultos obvios y directos.
const LOCAL_BAD_WORDS = [
  'idiota', 'imbécil', 'estúpido', 'estupido', 'muérete', 'muerete', 'suicídate',
  'puta', 'puto', 'zorra', 'perra', 'naco', 'gordo', 'gorda', 'asco',
  'te voy a matar', 'te voy a buscar', 'te voy a encontrar'
];

/**
 * La estrategia de 3 etapas para analizar mensajes ANÓNIMOS.
 * Etapa 1: Filtro local de palabras (Gratis)
 * Etapa 2: Modelo de Moderación de OpenAI (Gratis)
 * Etapa 3: Análisis de Relevancia (SOLO INFORMATIVO, YA NO BLOQUEA)
 */
const analyzeMessage = async (content, creatorPreference) => {
  const lowerCaseContent = content.toLowerCase();

  // --- ETAPA 1 y 2 (Seguridad Básica - SE MANTIENE) ---
  for (const word of LOCAL_BAD_WORDS) {
    if (lowerCaseContent.includes(word)) {
      console.log(`[AI Moderation] Bloqueado por palabra clave: ${word}`);
      return { isSafe: false, reason: 'Tu mensaje contiene lenguaje ofensivo prohibido.' };
    }
  }

  try {
    const modResponse = await openai.moderations.create({ input: content });
    if (modResponse.results[0].flagged) {
      console.log(`[AI Moderation] Bloqueado por OpenAI Moderation`);
      return { isSafe: false, reason: 'Tu mensaje infringe las normas de seguridad.' };
    }
  } catch (modError) {
    console.error("Error en Moderación Gratuita (ignorando fallo):", modError);
  }

  // --- ETAPA 3: Análisis de Contexto (YA NO BLOQUEA POR TEMA) ---
  // Si el creador no puso nada, el tema es LIBRE.
  const preference = creatorPreference || "Cualquier tema.";
  
  const prompt = `
  Analiza el siguiente mensaje.
  
  Contexto deseado por el creador: "${preference}".
  
  Tu tarea es asignar un puntaje de relevancia (1-10) y verificar seguridad.
  NO seas estricto con la relevancia. Si es un mensaje normal, es seguro.
  Solo marca 'UNSAFE' si es acoso real, amenazas o contenido ilegal.
  
  Responde JSON: {"safety": "SAFE" | "UNSAFE", "relevance_score": number}
  
  Mensaje: "${content}"
`;

  try {
    const modelToUse = "gpt-3.5-turbo-0125"; 
    
    const response = await openai.chat.completions.create({
      model: modelToUse,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: content }
      ],
      max_tokens: 100, 
      temperature: 0,
      response_format: { type: "json_object" } 
    });

    const jsonText = response.choices[0].message.content.trim();
    const result = JSON.parse(jsonText);

    // 1. Seguridad (EL ÚNICO FRENO)
    if (result.safety === 'UNSAFE') {
      console.log(`[AI] Bloqueado por Seguridad (GPT): ${content.substring(0, 20)}...`);
      return { isSafe: false, reason: 'Mensaje bloqueado por seguridad.' };
    }

    // 2. Relevancia (AHORA ES SOLO UN DATO, NO UNA BARRERA)
    const relevanceScore = parseInt(result.relevance_score, 10) || 5;
    
    // ❌ ELIMINADO: El bloque que rechazaba si score <= 3.
    // "La Vía Negativa": Quitamos la fricción. Todo mensaje seguro PASA.

    console.log(`[AI] Aprobado. Relevancia: ${relevanceScore} (Tema: ${preference})`);
    
    return { isSafe: true, relevance: relevanceScore };

  } catch (error) {
    console.error(`ERROR AI (Etapa 3):`, error);
    // Si la IA falla, APROBAMOS. No perdemos dinero por errores técnicos.
    return { isSafe: true, relevance: 5 }; 
  }
};

/**
 * (FUNCIÓN AUDITORA - RESPUESTA DEL CREADOR)
 * También la hacemos permisiva. El creador ya cobró, déjalo responder.
 */
async function analyzeCreatorResponse(responseContent, premiumContract, lastAnonQuestion) {
    // Retornamos TRUE siempre.
    // En el MVP, no queremos bloquear al creador de liberar su dinero.
    return { success: true, reason: "Aprobado por MVP" };
}

module.exports = { 
  analyzeMessage,
  analyzeCreatorResponse
};