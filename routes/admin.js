// routes/admin.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function adminRoutes(fastify, opts) {
  /**
   * Ruta segura para cambiar el estado premium de un usuario por email.
   * Espera un body: { "email": "usuario@gmail.com", "status": true }
   */
  fastify.post(
    '/admin/set-premium',
    // Usamos el plugin de autenticación que acabamos de crear
    { preHandler: [fastify.adminAuthenticate] },
    async (req, reply) => {
      const { email, status } = req.body;

      if (!email || typeof status !== 'boolean') {
        return reply.code(400).send({ 
          error: 'Email (string) y status (boolean) son requeridos.' 
        });
      }

      try {
        const updatedCreator = await prisma.creator.update({
          where: { email: email },
          data: {
            isPremium: status,
            // Opcional: poner un estado para saber que fue un admin
            subscriptionStatus: status ? 'admin_granted' : 'admin_revoked',
          },
        });

        fastify.log.info(`Estado premium de ${email} cambiado a ${status}`);
        reply.send({
          success: true,
          email: updatedCreator.email,
          isPremium: updatedCreator.isPremium,
        });

      } catch (err) {
        if (err.code === 'P2025') { // Código de Prisma para "Record not found"
          reply.code(404).send({ error: `Usuario con email ${email} no encontrado` });
        } else {
          fastify.log.error(err, "Error al actualizar premium");
          reply.code(500).send({ error: 'Error interno al actualizar el usuario' });
        }
      }
    }
  );
}

module.exports = adminRoutes;