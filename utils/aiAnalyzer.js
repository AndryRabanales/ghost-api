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
const analyzeMessage = async (content, creatorPreference) => {
  const lowerCaseContent = content.toLowerCase();

  // --- ETAPA 1 y 2 (Sin cambios) ---
  // ... (código de Etapa 1 y Etapa 2 sin cambios) ...
  for (const word of LOCAL_BAD_WORDS) {
    if (lowerCaseContent.includes(word)) {
      console.log(`[AI Moderation - ETAPA 1] Mensaje BLOQUEADO (Palabra clave): ${word}`);
      return { isSafe: false, reason: 'Tu mensaje fue bloqueado por moderación.' };
    }
  }

  try {
    const modResponse = await openai.moderations.create({ input: content });
    if (modResponse.results[0].flagged) {
      console.log(`[AI Moderation - ETAPA 2] Mensaje BLOQUEADO (Moderación Gratuita)`);
      return { isSafe: false, reason: 'Tu mensaje fue bloqueado por moderación.' };
    }
  } catch (modError) {
    console.error("ERROR en AI Analyzer (Etapa 2 - Moderación Gratuita):", modError);
  }

  // --- ETAPA 3: "Detective" de Contexto y Relevancia (Costo: $ PAGO) ---
  const preference = creatorPreference || "Mensajes sobre temas de vida, coaching y consejos.";
  
  const prompt = `
    Analiza el siguiente mensaje de un fan. Tu tarea es evaluarlo en dos puntos CRUCIALES.
    
    Punto 1: SEGURIDAD (SAFE/UNSAFE). Considera 'UNSAFE' CUALQUIER insinuación sexual, pregunta personal sospechosa, acoso sutil o amenaza.
    
    Punto 2: RELEVANCIA TEMÁTICA. El creador configuró su tema deseado como: "${preference}". Clasifica la relevancia del mensaje a este tema con un número del 1 al 10. (10 = Totalmente Relevante).
    
    Tu respuesta debe ser una cadena de texto en formato JSON, SIN NINGÚN TEXTO ADICIONAL.
    Formato requerido: {"safety": "SAFE o UNSAFE", "relevance_score": [número del 1 al 10]}
    
    Mensaje del Fan: "${content}"
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: content }
      ],
      max_tokens: 100, // Ajuste para el JSON
      temperature: 0,
      response_format: { type: "json_object" } // CLAVE: Pedir JSON
    });

    const jsonText = response.choices[0].message.content.trim();
    const result = JSON.parse(jsonText);

    // --- Lógica de Seguridad (E1 - El Policía) ---
    if (result.safety === 'UNSAFE') {
      console.log(`[AI Moderation - ETAPA 3] Mensaje BLOQUEADO (GPT-4o-mini): ${content.substring(0, 30)}...`);
      return { isSafe: false, reason: 'Tu mensaje fue bloqueado por moderación.' };
    }

    // --- Lógica de Relevancia (E4 - El Valor) ---
    const relevanceScore = parseInt(result.relevance_score, 10);
    if (isNaN(relevanceScore)) throw new Error("IA no devolvió score de relevancia");

    console.log(`[AI Moderation - ETAPA 3] Mensaje APROBADO. Relevancia: ${relevanceScore}`);
    
    return { isSafe: true, relevance: relevanceScore };

  } catch (error) {
    console.error("ERROR en AI Analyzer (Etapa 3 - GPT-4o-mini):", error);
    // Si la IA de pago falla, lo dejamos pasar por ahora.
    return { isSafe: true, relevance: 5 }; // Score neutral por defecto (5)
  }
};

module.exports = { analyzeMessage };