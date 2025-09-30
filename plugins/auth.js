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
        id: creator.id,
        publicId: creator.publicId,
        isPremium: creator.isPremium,
      },
      JWT_SECRET,
      { expiresIn: "7d" } // 🔒 token expira en 7 días
    );
  });
  

  /**
   * Verifica el token y mete el payload en request.user
   */
  fastify.decorate("authenticate", async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Token requerido" });
      }

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);

      request.user = decoded; // { id, publicId, isPremium }
    } catch (err) {
      return reply.code(401).send({ error: "Token inválido o expirado" });
    }
  });
});


