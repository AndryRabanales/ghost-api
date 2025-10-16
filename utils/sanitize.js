// utils/sanitize.js

/**
 * Sanitiza un string reemplazando caracteres HTML para prevenir ataques XSS.
 * @param {string} text El texto a sanitizar.
 * @returns {string} El texto sanitizado.
 */
function sanitize(text) {
    if (typeof text !== 'string') {
      return text === null || text === undefined ? '' : String(text);
    }
    return text.replace(/[<>&"']/g, (match) => {
      switch (match) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '"': return '&quot;';
        case "'": return '&#39;'; // O puedes usar &apos;
        default: return match;
      }
    });
  }
  
  module.exports = { sanitize };