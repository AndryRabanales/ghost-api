// Contenido para: src/utils/timeAgo.js

/**
 * Convierte una fecha ISO en un string "hace X tiempo".
 * @param {string} dateString La fecha en formato ISO (ej. "2025-11-03T22:00:00.000Z")
 * @returns {string | null} El string formateado o null si la fecha es inválida.
 */
export function timeAgo(dateString) {
    if (!dateString) return null;
  
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null; // Devuelve null si la fecha es inválida
  
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
    // Menos de 30 segundos
    if (seconds < 30) return "justo ahora";
    
    // Menos de 1 minuto
    if (seconds < 60) return "hace unos segundos";
  
    // Minutos
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  
    // Horas
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  
    // Días
    const days = Math.floor(hours / 24);
    if (days < 30) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  
    // Meses
    const months = Math.floor(days / 30);
    if (months < 12) return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  
    // Años
    const years = Math.floor(months / 12);
    return `hace ${years} ${years === 1 ? "año" : "años"}`;
  }