// routes/creators.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function creatorsRoutes(fastify, opts) {
  /**
   * Crear un nuevo creator/dashboard
   */
  fastify.post("/creators", async (req, reply) => {
    try {
      const { name } = req.body;

      if (!name) {
        return reply.code(400).send({ error: "El nombre es obligatorio" });
      }

      const dashboardId = crypto.randomUUID();
      const publicId = crypto.randomUUID();

      const creator = await prisma.creator.create({
        data: {
          id: dashboardId,
          publicId,
          name,
        },
      });

      // Generar token JWT
      const token = fastify.generateToken(creator);

      const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const dashboardUrl = `${baseUrl}/dashboard/${dashboardId}`;
      const publicUrl = `${baseUrl}/u/${publicId}`;

      reply.code(201).send({
        dashboardUrl,
        publicUrl,
        dashboardId,
        publicId,
        token,
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error creando creator" });
    }
  });

  /**
   * Login por publicId → devuelve token
   */
  fastify.post("/creators/login", async (req, reply) => {
    try {
      const { publicId } = req.body;

      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator) {
        return reply.code(404).send({ error: "Creator no encontrado" });
      }

      const token = fastify.generateToken(creator);
      reply.send({ token, creator });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error en login" });
    }
  });

  /**
   * Obtener mi perfil (requiere auth)
   */
  fastify.get(
    "/creators/me",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      try {
        const creator = await prisma.creator.findUnique({
          where: { id: req.user.id },
        });
        if (!creator) return reply.code(404).send({ error: "No encontrado" });

        reply.send(creator);
      } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({ error: "Error obteniendo perfil" });
      }
    }
  );
}

module.exports = creatorsRoutes;
