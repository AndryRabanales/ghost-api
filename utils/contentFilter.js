// utils/contentFilter.js — filtro básico de contenido abusivo (moderación 6.3)
// Bloquea amenazas graves e insultos severos en mensajes anónimos entrantes.
// Es deliberadamente conservador: filtra lo grave, no la palabra fuerte casual,
// porque el creador puede además reportar/bloquear desde la app.

const SEVERE_PATTERNS = [
  // Amenazas / incitación (es)
  /\bte\s+voy\s+a\s+matar\b/i,
  /\bte\s+vas?\s+a\s+morir\b/i,
  /\bmatate\b/i,
  /\bm[aá]tate\b/i,
  /\bsuicidate\b/i,
  /\bsuic[ií]date\b/i,
  /\bojal[aá]\s+te\s+mueras\b/i,
  /\bte\s+voy\s+a\s+violar\b/i,
  // Amenazas (en)
  /\bkill\s+yourself\b/i,
  /\bkys\b/i,
  /\bi('|)ll\s+kill\s+you\b/i,
  /\bgo\s+die\b/i,
  // Slurs graves (es/en) — lista corta y de alto consenso
  /\bni[gq]{2}er\b/i,
  /\bfaggot\b/i,
];

/**
 * Devuelve { ok: true } si el mensaje pasa, o { ok: false, reason } si se
 * bloquea por contenido de abuso grave.
 */
function checkContent(text) {
  const t = String(text || "");
  for (const re of SEVERE_PATTERNS) {
    if (re.test(t)) {
      return {
        ok: false,
        reason:
          "Tu mensaje contiene contenido que no está permitido (amenazas o acoso grave).",
      };
    }
  }
  return { ok: true };
}

module.exports = { checkContent };
