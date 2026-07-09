// andryrabanales/ghost-api/ghost-api-f289b0fb0e4515f9ff7114d9c446c0d0b6c62eee/plugins/auth.js
const fp = require('fastify-plugin');
const jwt = require('jsonwebtoken');

async function authPlugin(fastify, opts) {
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      if (!request.headers.authorization) {
        throw new Error('No token was sent');
      }
      const token = request.headers.authorization.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      request.user = decoded;
    } catch (err) {
      reply.code(401).send({ error: 'Authentication failed', message: err.message });
    }
  });

  fastify.decorate('generateToken', function (creator) {
    // Sin expiración: la sesión del creador nunca caduca (solo se cierra
    // manualmente con "Cerrar sesión"). No pasamos expiresIn a propósito.
    return jwt.sign(
      { id: creator.id, publicId: creator.publicId, name: creator.name },
      process.env.JWT_SECRET
    );
  });
}

module.exports = fp(authPlugin);