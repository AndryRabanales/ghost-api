// Carga las variables del .env (¡MUY IMPORTANTE!)
require('dotenv').config();

// Importa la función que acabamos de crear
const { analyzeMessage } = require('./utils/aiAnalyzer'); //

// Mensajes de prueba
const safeMessage = "Hola, me encanta tu contenido. Sigue así!";
const bullyMessage = "Eres un idiota y todo lo que haces es basura.";
const suspiciousMessage = "Qué guapa te ves, deberías decirme dónde vives para conocerte.";
const neutralMessage = "¿A qué hora subes video mañana?";

// Creamos una función "async" para poder usar 'await'
const runTest = async () => {
  console.log("--- Iniciando Prueba de Moderación de IA ---");
  
  console.log("\nProbando mensaje SEGURO:");
  let result = await analyzeMessage(safeMessage);
  console.log("Resultado:", result); // Debería decir { isSafe: true }

  console.log("\nProbando mensaje de ACOSO:");
  result = await analyzeMessage(bullyMessage);
  console.log("Resultado:", result); // Debería decir { isSafe: false }

  console.log("\nProbando mensaje SOSPECHOSO:");
  result = await analyzeMessage(suspiciousMessage);
  console.log("Resultado:", result); // Debería decir { isSafe: false }

  console.log("\nProbando mensaje NEUTRAL:");
  result = await analyzeMessage(neutralMessage);
  console.log("Resultado:", result); // Debería decir { isSafe: true }

  console.log("\n--- Prueba Finalizada ---");
};

// Ejecuta la prueba
runTest();