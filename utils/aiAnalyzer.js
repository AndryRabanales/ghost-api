// andryrabanales/ghost-api/ghost-api-282b77c99f664dcc9acae14a9880ffdd34fc9b54/utils/aiAnalyzer.js

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
 * (FUNCIÓN EXISTENTE)
 * La estrategia de 3 etapas para analizar mensajes ANÓNIMOS.
 * Etapa 1: Filtro local de palabras (Gratis)
 * Etapa 2: Modelo de Moderación de OpenAI (Gratis)
 * Etapa 3: Modelo de Contexto GPT-4o-mini (De Pago)
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
    
    Punto 2: RELEVANCIA TEMÁTICA. El creador configuró su tema deseado como: "${preference}". Clasifica la relevancia del mensaje a este tema con un número del 1 al 10. (10 = Totalmente Relevante).
    
    Tu respuesta debe ser una cadena de texto en formato JSON, SIN NINGÚN TEXTO ADICIONAL.
    Formato requerido: {"safety": "SAFE o UNSAFE", "relevance_score": [número del 1 al 10]}
    
    Mensaje del Fan: "${content}"
  `;

  try {
    // Usamos el modelo que mencionaste, gpt-3.5-turbo, o gpt-4o-mini si prefieres más potencia
    const modelToUse = "gpt-3.5-turbo-0125"; // O "gpt-4o-mini"
    
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
    const relevanceScore = parseInt(result.relevance_score, 10);
    if (isNaN(relevanceScore)) throw new Error("IA no devolvió score de relevancia");

    console.log(`[AI Moderation - ETAPA 3] Mensaje APROBADO. Relevancia: ${relevanceScore}`);
    
    return { isSafe: true, relevance: relevanceScore };

  } catch (error) {
    console.error(`ERROR en AI Analyzer (Etapa 3 - ${modelToUse}):`, error);
    // Si la IA de pago falla, lo dejamos pasar por ahora.
    return { isSafe: true, relevance: 5 }; // Score neutral por defecto (5)
  }
};


// --- 👇 FUNCIÓN NUEVA AÑADIDA 👇 ---

/**
 * (NUEVA FUNCIÓN)
 * Analiza la RESPUESTA de un creador para asegurar que cumple con su
 * contrato de servicio y no es una respuesta genérica de baja calidad.
 *
 * @param {string} responseContent La respuesta que escribió el creador.
 * @param {string} premiumContract La promesa/contrato del creador (ej. "Respuesta de +100 caracteres con 1 foto").
 * @returns {Promise<{success: boolean, reason: string}>}
 */
async function analyzeCreatorResponse(responseContent, premiumContract) {
  // 1. Usar un prompt de "auditor".
  // Usamos el 3.5-turbo que mencionaste, es rápido y barato para esta tarea.
  const prompt = `
    Eres un auditor de calidad. Un creador ha prometido a su cliente: "${premiumContract}".
    El creador ha escrito la siguiente respuesta para liberar su pago: "${responseContent}".

    Tu tarea es determinar si la respuesta cumple la promesa y NO es una respuesta genérica o de bajo esfuerzo (como "gracias", "saludos", "hola").

    Responde SOLAMENTE con un objeto JSON con dos claves:
    1. "cumple_promesa": (true/false)
    2. "razon": (Una explicación MUY BREVE de por qué, especialmente si es 'false'. Ej: "Respuesta demasiado corta", "Respuesta genérica", "No cumple el contrato")

    Ejemplos de respuestas de BAJA CALIDAD (false):
    - "jaja gracias por tu mensaje, saludos!"
    - "Muchas gracias por tu apoyo, sigue viendo mis videos."
    - "Claro que sí, te mando un saludo."

    Ejemplos de respuestas de ALTA CALIDAD (true):
    - "Hola! Sobre tu pregunta de negocios, mi consejo es que te enfoques en el marketing digital primero..."
    - "¡Gracias por tus palabras! La verdad es que empecé mi canal porque me apasionaba..."

    Analiza la respuesta.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-0125", // Usamos el 3.5-turbo como mencionaste
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: responseContent }
      ],
      max_tokens: 100,
      temperature: 0.1, // Queremos que sea estricto y consistente
      response_format: { type: "json_object" }
    });

    const jsonText = response.choices[0].message.content.trim();
    const result = JSON.parse(jsonText);

    if (result.cumple_promesa === true) {
      console.log(`[AI Auditor - Creador] ✅ Respuesta APROBADA. Razón: ${result.razon}`);
      return { success: true, reason: result.razon };
    } else {
      console.log(`[AI Auditor - Creador] ❌ Respuesta BLOQUEADA. Razón: ${result.razon}`);
      // Devolvemos la razón del rechazo para mostrarla al creador
      return { success: false, reason: result.razon || "La respuesta no cumple con tu Contrato de Servicio o es de baja calidad." };
    }

  } catch (error) {
    console.error("ERROR en AI Auditor (Creador):", error);
    // En caso de error de la API, somos optimistas y la dejamos pasar.
    // Podrías cambiar esto a 'false' si prefieres ser estricto.
    return { success: true, reason: "Error de IA (Pase temporal)" };
  }
}


// --- 👇 EXPORTACIÓN ACTUALIZADA 👇 ---
module.exports = { 
  analyzeMessage,
  analyzeCreatorResponse
};