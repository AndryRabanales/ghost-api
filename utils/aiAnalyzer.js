const { OpenAI } = require("openai");

// 1. Carga la clave API de OpenAI desde el archivo .env
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
 * (FUNCIÓN EXISTENTE - CORREGIDA)
 * La estrategia de 3 etapas para analizar mensajes ANÓNIMOS.
 * Etapa 1: Filtro local de palabras (Gratis)
 * Etapa 2: Modelo de Moderación de OpenAI (Gratis)
 * Etapa 3: Modelo de Contexto GPT-4o-mini (De Pago) - AHORA BLOQUEA POR TEMA
 */
const analyzeMessage = async (content, creatorPreference) => {
  const lowerCaseContent = content.toLowerCase();

  // --- ETAPA 1 y 2 (Sin cambios) ---
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
    
    Punto 2: RELEVANCIA TEMÁTICA. El creador configuró su tema deseado como: "${preference}".
    Tu tarea es asignar un puntaje de relevancia del 1 al 10.
    
    ¡IMPORTANTE: No seas estricto con el puntaje! Sigue estas reglas:
    -   Si el mensaje es respetuoso pero NO está relacionado con el tema (ej: "Hola", "¿Cómo estás?", "Me encanta tu trabajo"), asígnale un puntaje base neutral de **5**.
    -   Si el mensaje SÍ está relacionado con el tema ("${preference}"), dale un puntaje más alto (**6-10**) según qué tan relevante sea.
    -   Si el mensaje es spam obvio o texto sin sentido (ej: "asdasd", "compra esto") o totalmente fuera de contexto, dale un puntaje bajo (**1-3**).
    
    Tu respuesta debe ser una cadena de texto en formato JSON, SIN NINGÚN TEXTO ADICIONAL.
    Formato requerido: {"safety": "SAFE o UNSAFE", "relevance_score": [número del 1 al 10]}
    
    Mensaje del Fan: "${content}"
  `;

  try {
    const modelToUse = "gpt-3.5-turbo-0125"; 
    
    const response = await openai.chat.completions.create({
      model: modelToUse,
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
      console.log(`[AI Moderation - ETAPA 3] Mensaje BLOQUEADO (${modelToUse}): ${content.substring(0, 30)}...`);
      return { isSafe: false, reason: 'Tu mensaje fue bloqueado por moderación.' };
    }

    // --- Lógica de Relevancia (E4 - El Valor) ---
    // 👇 AQUÍ ESTÁ LA CORRECCIÓN: Bloquear si el score es bajo 👇
    const relevanceScore = parseInt(result.relevance_score, 10);
    
    if (!isNaN(relevanceScore) && relevanceScore <= 3) {
        console.log(`[AI Moderation - ETAPA 3] ⛔ BLOQUEADO por Irrelevancia (Score: ${relevanceScore}). Tema: ${preference}`);
        return { 
            isSafe: false, 
            reason: `Tu mensaje no tiene que ver con el tema del creador: "${preference}".` 
        };
    }

    console.log(`[AI Moderation - ETAPA 3] ✅ Mensaje APROBADO. Relevancia: ${relevanceScore}`);
    
    return { isSafe: true, relevance: relevanceScore };

  } catch (error) {
    console.error(`ERROR en AI Analyzer (Etapa 3 - fallback):`, error);
    // Si la IA de pago falla, lo dejamos pasar con score neutral por defecto.
    return { isSafe: true, relevance: 5 }; 
  }
};


// --- 👇 FUNCIÓN AUDITORA (CREADOR) 👇 ---
/**
 * Analiza la RESPUESTA de un creador para asegurar que cumple con su
 * contrato Y que es relevante para la pregunta del anónimo.
 */
async function analyzeCreatorResponse(responseContent, premiumContract, lastAnonQuestion) {
  
  // Si no hay pregunta previa (raro, pero posible), usamos un texto neutral
  const questionContext = lastAnonQuestion || "la pregunta del usuario";

  const prompt = `
    Eres un auditor de calidad. Tu principal objetivo es ser permisivo. NO seas estricto.

    Revisa la siguiente interacción:
    1.  **La Pregunta del Anónimo:** "${questionContext}"
    2.  **La Promesa del Creador (su contrato):** "${premiumContract}"
    3.  **La Respuesta del Creador:** "${responseContent}"

    Tu tarea es determinar si la respuesta es válida.
    Debes APROBAR (true) casi todo, EXCEPTO lo siguiente:

    Rechaza (false) ÚNICAMENTE si la respuesta es:
    -   Evidentemente genérica (ej: "gracias", "ok", "jaja", "excelente pregunta")
    -   De muy bajo esfuerzo o evasiva (ej: "no sé", "...", "luego te digo")
    -   Ignora TOTALMENTE la pregunta o el tema del anónimo.
    -   Contradice directamente la promesa del contrato (ej: promete audio y da texto).

    No juzgues la "calidad" más allá de estos puntos. Solo filtra lo obvio y el spam. El objetivo es que el creador cobre su dinero.

    Responde SOLAMENTE con un objeto JSON con dos claves:
    1. "cumple_promesa": (true/false)
    2. "razon": (Explicación breve si es 'false'. Ej: "Respuesta genérica", "Ignora la pregunta")
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-0125", // Rápido y barato
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: responseContent } // El 'user' es el creador en este contexto
      ],
      max_tokens: 100,
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const jsonText = response.choices[0].message.content.trim();
    const result = JSON.parse(jsonText);

    if (result.cumple_promesa === true) {
      console.log(`[AI Auditor - Creador] ✅ Respuesta APROBADA. Razón: ${result.razon}`);
      return { success: true, reason: result.razon };
    } else {
      console.log(`[AI Auditor - Creador] ❌ Respuesta BLOQUEADA. Razón: ${result.razon}`);
      return { success: false, reason: result.razon || "La respuesta no cumple con la calidad o no es relevante." };
    }

  } catch (error) {
    console.error("ERROR en AI Auditor (Creador):", error);
    return { success: true, reason: "Error de IA (Pase temporal)" }; // Pase optimista
  }
}


module.exports = { 
  analyzeMessage,
  analyzeCreatorResponse
};