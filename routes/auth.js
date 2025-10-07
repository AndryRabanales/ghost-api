// routes/auth.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient(); // ✨ CORRECCIÓN AQUÍ
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken"); // Asegúrate de importar jwt

async function authRoutes(fastify, opts) {
  // --- Endpoint para REGISTRAR un nuevo usuario ---
  fastify.post("/auth/register", async (req, reply) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return reply.code(400).send({ error: "Nombre, email y contraseña son obligatorios" });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      // ---- LÓGICA DE ACTUALIZACIÓN DE INVITADO ----
      let creator;
      const authHeader = req.headers.authorization;

      if (authHeader) {
        try {
          const token = authHeader.replace('Bearer ', '');
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          
          const guestCreator = await prisma.creator.findUnique({ where: { id: decoded.id } });

          if (guestCreator && !guestCreator.email) {
            creator = await prisma.creator.update({
              where: { id: guestCreator.id },
              data: { name, email, password: hashedPassword },
            });
            fastify.log.info(`Cuenta de invitado ${guestCreator.id} actualizada a usuario registrado.`);
          }
        } catch (e) {
          fastify.log.warn('Token de invitado inválido durante el registro, creando nueva cuenta.');
        }
      }

      if (!creator) {
        creator = await prisma.creator.create({
          data: {
            id: crypto.randomUUID(),
            publicId: crypto.randomUUID(),
            name,
            email,
            password: hashedPassword,
          },
        });
      }
      
      const newToken = fastify.generateToken(creator);
      reply.code(201).send({ token: newToken, publicId: creator.publicId, name: creator.name, dashboardId: creator.id });

    } catch (e) {
      if (e.code === 'P2002') {
        return reply.code(409).send({ error: "El email ya está en uso" });
      }
      fastify.log.error(e);
      reply.code(500).send({ error: "Error al crear la cuenta" });
    }
  });

  // --- Endpoint para INICIAR SESIÓN (se queda igual) ---
  fastify.post("/auth/login", async (req, reply) => {
    const { email, password } = req.body;

    const creator = await prisma.creator.findUnique({ where: { email } });
    if (!creator) {
      return reply.code(401).send({ error: "Credenciales inválidas" });
    }

    const match = await bcrypt.compare(password, creator.password);
    if (!match) {
      return reply.code(401).send({ error: "Credenciales inválidas" });
    }

    const token = fastify.generateToken(creator);
    reply.send({ token, publicId: creator.publicId, name: creator.name, dashboardId: creator.id });
  });
}

module.exports = authRoutes;