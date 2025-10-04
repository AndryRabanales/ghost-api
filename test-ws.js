// test-ws.js
const WebSocket = require("ws");

const chatId = "test";
const ws = new WebSocket(`ws://localhost:8080/ws/chat?chatId=${chatId}`);

ws.on("open", () => {
  console.log("✅ Conectado al WS");
  // Enviar mensaje de prueba
  ws.send(JSON.stringify({ content: "Hola desde Node!" }));
});

ws.on("message", (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log("📩 Mensaje recibido:", msg);
  } catch {
    console.log("📩 Mensaje recibido (raw):", data.toString());
  }
});

ws.on("close", () => {
  console.log("❌ Conexión cerrada");
});

ws.on("error", (err) => {
  console.error("⚠️ Error WS:", err);
});
