// plugins/adminAuth.js
const fp = require('fastify-plugin');

async function adminAuthPlugin(fastify, opts) {
  // Creamos una función de decoración que podemos reusar
  fastify.decorate('adminAuthenticate', async function (request, reply) {
    try {
      const adminKey = request.headers['x-admin-key'];
      const expectedKey = process.env.ADMIN_API_KEY;

      if (!expectedKey) {
        fastify.log.error("ADMIN_API_KEY no está configurada en .env");
        throw new Error("Autorización no configurada");
      }

      if (!adminKey || adminKey !== expectedKey) {
        throw new Error("Llave de admin inválida o faltante");
      }
      // Si la llave es correcta, la petición continúa
    } catch (err) {
      reply.code(401).send({ error: 'Acceso no autorizado', message: err.message });
    }
  });
}

module.exports = fp(adminAuthPlugin);