/*
 * utils/aiAnalyzer.js
 * Este servicio carga los modelos de IA y proporciona métodos para analizar texto.
 * Usa import() dinámico para cargar el módulo ESM @xenova/transformers en un entorno CommonJS.
 */

// Variables para "cachear" los módulos y modelos cargados
let pipeline, env;
let moderationPipeline = null;
let emotionPipeline = null;

// Tus etiquetas personalizadas para la regla de negocio
const MODERATION_LABELS = [
    'amenaza',
    'acoso',
    'odio',
    'ofensa intencional',
    'comentario neutral',
    'grosería no ofensiva'
];

/**
 * Carga los módulos ESM y los modelos de IA en memoria.
 * Se debe llamar una sola vez al iniciar el servidor.
 */
async function initializeAI() {
    // Evita recargar si ya está listo
    if (moderationPipeline && emotionPipeline) return true;

    try {
        // 1. Carga dinámica del paquete ESM
        const transformers = await import('@xenova/transformers');
        pipeline = transformers.pipeline;
        env = transformers.env;

        // 2. Configuración del entorno
        env.allowLocalModels = false;
        env.useBrowserCache = false; // Adecuado para un servidor

        // 3. Carga de los modelos (pipelines)
        console.log('IA: Cargando modelo de moderación (zero-shot)...');
        // Usamos un modelo "zero-shot" para poder definir nuestras propias etiquetas
        moderationPipeline = await pipeline(
            'zero-shot-classification',
            'Xenova/bart-large-mnli' // Modelo multilingüe para esta tarea
        );
        console.log('IA: Modelo de moderación cargado.');

        console.log('IA: Cargando modelo de emociones...');
        // Usamos un modelo específico para emociones/sentimiento
        emotionPipeline = await pipeline(
            'text-classification',
            'Xenova/bert-base-multilingual-uncased-sentiment'
        );
        console.log('IA: Modelo de emociones cargado.');
        
        return true;

    } catch (err) {
        console.error('Error fatal al cargar modelos de IA:', err);
        // Esto podría pasar si Hugging Face está caído o hay un problema de red
        return false;
    }
}

/**
 * Analiza un texto para moderación usando las etiquetas personalizadas.
 * @param {string} text - El contenido del mensaje.
 * @returns {Promise<object | null>} - Un objeto con los scores o null si falla.
 */
async function analyzeModeration(text) {
    if (!moderationPipeline) {
        console.warn('El pipeline de moderación no está listo. Llamando a initializeAI...');
        await initializeAI(); // Intento de recuperación
        if (!moderationPipeline) {
            console.error('Fallo en recuperación de pipeline de moderación.');
            return null;
        }
    }
    try {
        const result = await moderationPipeline(text, MODERATION_LABELS, { multi_label: true });
        
        // Estructuramos el resultado
        const scores = {};
        result.labels.forEach((label, index) => {
            scores[label.replace(/ /g, '_')] = result.scores[index]; // ej: 'ofensa_intencional': 0.9
        });
        return scores;

    } catch (err) {
        console.error(`Error en analyzeModeration: ${err.message}`);
        return null;
    }
}

/**
 * Analiza un texto para detectar la emoción principal.
 * @param {string} text - El contenido del mensaje.
 * @returns {Promise<string | null>} - El nombre de la emoción (ej: "anger") o null.
 */
async function analyzeEmotion(text) {
    if (!emotionPipeline) {
        console.warn('El pipeline de emociones no está listo. Llamando a initializeAI...');
        await initializeAI(); // Intento de recuperación
        if (!emotionPipeline) {
            console.error('Fallo en recuperación de pipeline de emoción.');
            return null;
        }
    }
    try {
        const result = await emotionPipeline(text);
        // Devuelve la etiqueta con mayor puntuación (ej: 'positive', 'negative', o nombres de emociones)
        return result[0].label; 
    } catch (err) {
        console.error(`Error en analyzeEmotion: ${err.message}`);
        return null;
    }
}

/**
 * Función principal que ejecuta todos los análisis y aplica la lógica de negocio.
 * @param {string} text - El contenido del mensaje.
 * @returns {Promise<object>} - Un objeto con el análisis completo.
 */
async function analyzeMessage(text) {
    const analysis = {
        status: 'PENDING',
        isFlagged: false,
        threatScore: 0.0,
        harassmentScore: 0.0,
        offenseScore: 0.0,
        detectedEmotion: null,
    };

    try {
        // 1. Ejecutar análisis de moderación
        const modScores = await analyzeModeration(text);
        
        if (modScores) {
            analysis.threatScore = modScores.amenaza || 0.0;
            analysis.harassmentScore = modScores.acoso || 0.0;
            analysis.offenseScore = modScores.ofensa_intencional || 0.0;
            
            // 2. Aplicar tu REGLA DE NEGOCIO
            // El mensaje se marca si la intención de ofensa, acoso o amenaza es alta.
            const THRESHOLD = 0.70; // Umbral de confianza (puedes ajustar esto)
            if (
                analysis.threatScore > THRESHOLD ||
                analysis.harassmentScore > THRESHOLD ||
                analysis.offenseScore > THRESHOLD
            ) {
                analysis.isFlagged = true;
            }
        }

        // 3. Ejecutar análisis de emoción
        const emotion = await analyzeEmotion(text);
        if (emotion) {
            analysis.detectedEmotion = emotion;
        }

        analysis.status = 'ANALYZED';
        return analysis;

    } catch (err) {
        console.error(`Error en analyzeMessage: ${err.message}`);
        analysis.status = 'ERROR';
        return analysis;
    }
}

// Exportamos las funciones que usaremos fuera
module.exports = {
    initializeAI,
    analyzeMessage
};