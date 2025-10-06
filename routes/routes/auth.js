// routes/auth.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcrypt");
const crypto = require("crypto");

async function authRoutes(fastify, opts) {
  // --- Endpoint para REGISTRAR un nuevo usuario ---
  fastify.post("/auth/register", async (req, reply) => {
    const { name, email, password } = req.body;

    // Validación simple de los campos
    if (!name || !email || !password) {
      return reply.code(400).send({ error: "Nombre, email y contraseña son obligatorios" });
    }

    try {
      // Hashear la contraseña antes de guardarla
      const hashedPassword = await bcrypt.hash(password, 10);

      // Crear el nuevo usuario (Creator) en la base de datos
      const creator = await prisma.creator.create({
        data: {
          id: crypto.randomUUID(),
          publicId: crypto.randomUUID(),
          name,
          email,
          password: hashedPassword,
        },
      });

      // Generar un token JWT para que el usuario inicie sesión automáticamente
      const token = fastify.generateToken(creator);
      reply.code(201).send({ token, publicId: creator.publicId, name: creator.name });

    } catch (e) {
      // Manejar el error común de que el email ya exista
      if (e.code === 'P2002') {
        return reply.code(409).send({ error: "El email ya está en uso" });
      }
      fastify.log.error(e);
      reply.code(500).send({ error: "Error al crear la cuenta" });
    }
  });

  // --- Endpoint para INICIAR SESIÓN ---
  fastify.post("/auth/login", async (req, reply) => {
    const { email, password } = req.body;

    // Buscar al usuario por su email
    const creator = await prisma.creator.findUnique({ where: { email } });
    if (!creator) {
      return reply.code(401).send({ error: "Credenciales inválidas" }); // Mensaje genérico por seguridad
    }

    // Comparar la contraseña enviada con la contraseña hasheada en la BD
    const match = await bcrypt.compare(password, creator.password);
    if (!match) {
      return reply.code(401).send({ error: "Credenciales inválidas" }); // Mensaje genérico por seguridad
    }

    // Si todo es correcto, generar y devolver un nuevo token
    const token = fastify.generateToken(creator);
    reply.send({ token, publicId: creator.publicId, name: creator.name });
  });
}

module.exports = authRoutes;