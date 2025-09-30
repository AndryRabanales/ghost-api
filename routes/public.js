"use client";
import { useState, useEffect } from "react";

const API =
  process.env.NEXT_PUBLIC_API || "https://ghost-api-2qmr.onrender.com";

export default function AnonMessageForm({ publicId }) {
  const [alias, setAlias] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState(null);
  const [chatUrl, setChatUrl] = useState(null);

  // 🔄 Revisar si ya existe un chat guardado para este alias
  useEffect(() => {
    if (!alias) return;
    const savedChat = localStorage.getItem(`chat_${publicId}_${alias}`);
    if (savedChat) {
      setChatUrl(savedChat);
    }
  }, [publicId, alias]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("loading");
    setChatUrl(null);

    try {
      const res = await fetch(`${API}/public/${publicId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, content }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error enviando mensaje");

      setContent("");
      setStatus("success");

      if (data.chatUrl) {
        setChatUrl(data.chatUrl);
        // 👇 Guardar chat en localStorage por alias
        localStorage.setItem(`chat_${publicId}_${alias || data.anonToken}`, data.chatUrl);
      }
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
      <input
        type="text"
        placeholder="Tu alias (opcional)"
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
        style={{ padding: 10, border: "1px solid #ccc", borderRadius: 6 }}
      />

      <textarea
        placeholder="Escribe tu mensaje anónimo..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        required
        style={{
          padding: 10,
          border: "1px solid #ccc",
          borderRadius: 6,
          minHeight: 100,
        }}
      />

      <button
        type="submit"
        disabled={status === "loading"}
        style={{
          padding: "10px 20px",
          backgroundColor: "#4CAF50",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {status === "loading" ? "Enviando..." : "Enviar mensaje"}
      </button>

      {status === "success" && (
        <div style={{ color: "green" }}>
          ✅ Mensaje enviado con éxito
          {chatUrl && (
            <p style={{ marginTop: 8 }}>
              🔗 Tu chat está aquí:{" "}
              <a
                href={chatUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#0070f3", textDecoration: "underline" }}
              >
                {chatUrl}
              </a>
            </p>
          )}
        </div>
      )}
      {status === "error" && (
        <p style={{ color: "red" }}>❌ Error al enviar el mensaje</p>
      )}
      {chatUrl && status !== "success" && (
        <p style={{ marginTop: 8, color: "#555" }}>
          📌 Ya tienes un chat guardado:{" "}
          <a
            href={chatUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#0070f3", textDecoration: "underline" }}
          >
            {chatUrl}
          </a>
        </p>
      )}
    </form>
  );
}
