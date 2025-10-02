// plugins/auth.js
const fp = require("fastify-plugin");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey"; // ⚠️ cámbialo en producción

module.exports = fp(async function (fastify, opts) {
  /**
   * Genera un token JWT para un creator
   */
  fastify.decorate("generateToken", (creator) => {
    return jwt.sign(
      {
        id: creator.id || null,           // ID único del dashboard
        publicId: creator.publicId || null, // ID público
        isPremium: creator.isPremium || false, // por si no está definido
      },
      JWT_SECRET,
      { expiresIn: "7d" } // ⏳ el token expira en 7 días
    );
  });

  /**
   * Middleware de autenticación
   */
  fastify.decorate("authenticate", async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Token requerido" });
      }

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);

      // Guardamos el payload en request.user (siempre trae id y publicId)
      request.user = decoded; // { id, publicId, isPremium }
    } catch (err) {
      fastify.log.error("❌ Error de autenticación:", err.message);
      return reply.code(401).send({ error: "Token inválido o expirado" });
    }
  });
});
