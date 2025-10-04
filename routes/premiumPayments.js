"use client";
import { useState, useEffect } from "react";
import { refreshToken, getAuthHeaders } from "@/utils/auth";

const API = process.env.NEXT_PUBLIC_API || "https://ghost-api-production.up.railway.app";

export default function PremiumButton({ onChange }) {
  const [loading, setLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false);

  const fetchCreatorStatus = async () => {
    try {
      let res = await fetch(`${API}/creators/me`, { headers: getAuthHeaders() });

      if (res.status === 401) {
        const publicId = localStorage.getItem("publicId");
        if (publicId) {
          const newToken = await refreshToken(publicId);
          if (newToken) {
            res = await fetch(`${API}/creators/me`, { headers: getAuthHeaders(newToken) });
          }
        }
      }
      if (!res.ok) return;
      const data = await res.json();
      setIsPremium(data.isPremium || false);
      if (onChange) onChange(data);
    } catch (err) {
      console.error("❌ Error en fetchCreatorStatus:", err);
    }
  };

  const handleBecomePremium = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API}/premium/create-payment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({}), // Enviamos un cuerpo vacío
      });

      const data = await response.json();

      if (response.ok && data.init_point) {
        window.location.href = data.init_point;
      } else {
        throw new Error(data.error || 'No se pudo crear el link de pago.');
      }
    } catch (error) {
      console.error('Error al iniciar el pago:', error);
      alert(`Hubo un error al procesar tu pago: ${error.message}`);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCreatorStatus();
  }, []);

  if (isPremium) {
    return (
      <div style={{ color: "gold", marginBottom: 8, padding: '10px', background: '#333', borderRadius: '8px', textAlign: 'center' }}>
        ⭐ ¡Eres Premium! Disfruta de vidas ilimitadas.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16, border: '1px solid #0070f3', padding: '15px', borderRadius: '8px', textAlign: 'center' }}>
      <h3 style={{marginTop: 0}}>¿Te quedas sin vidas?</h3>
      <p>¡Vuélvete Premium para tener respuestas ilimitadas!</p>
      <button
        onClick={handleBecomePremium}
        disabled={loading}
        style={{ padding: "10px 20px", borderRadius: 6, border: "none", background: "#0070f3", color: "#fff", cursor: loading ? "wait" : "pointer", fontWeight: 'bold', width: '100%', fontSize: '16px' }}
      >
        {loading ? "Generando link de pago..." : "🚀 Volverse Premium"}
      </button>
    </div>
  );
}