// routes/auth.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcrypt");
const crypto = require("crypto");

async function authRoutes(fastify, opts) {
  // --- Endpoint para REGISTRAR un nuevo usuario ---
  fastify.post("/auth/register", async (req, reply) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return reply.code(400).send({ error: "Nombre, email y contraseña son obligatorios" });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      const creator = await prisma.creator.create({
        data: {
          id: crypto.randomUUID(),
          publicId: crypto.randomUUID(),
          name,
          email,
          password: hashedPassword,
        },
      });

      const token = fastify.generateToken(creator);
      reply.code(201).send({ token, publicId: creator.publicId, name: creator.name });

    } catch (e) {
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

    const creator = await prisma.creator.findUnique({ where: { email } });
    if (!creator) {
      return reply.code(401).send({ error: "Credenciales inválidas" });
    }

    const match = await bcrypt.compare(password, creator.password);
    if (!match) {
      return reply.code(401).send({ error: "Credenciales inválidas" });
    }

    const token = fastify.generateToken(creator);
    reply.send({ token, publicId: creator.publicId, name: creator.name });
  });
}

module.exports = authRoutes;