// routes/auth.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

async function authRoutes(fastify, opts) {
  
  // --- Endpoint para REGISTRAR un nuevo usuario (CON INVITACIÓN) ---
  fastify.post("/auth/register", async (req, reply) => {
    const { name, email, password, inviteCode } = req.body;

    // 1. Validación de campos
    if (!name || !email || !password || !inviteCode) {
      return reply.code(400).send({ error: "Todos los campos son obligatorios, incluido el código de invitación." });
    }

    try {
      // 2. VERIFICAR CÓDIGO DE INVITACIÓN
      // Buscamos el código en la base de datos
      const validInvite = await prisma.inviteCode.findUnique({
        where: { code: inviteCode }
      });

      // Si no existe
      if (!validInvite) {
        return reply.code(400).send({ error: "Código de invitación no válido." });
      }

      // Si ya fue usado
      if (validInvite.isUsed) {
        return reply.code(409).send({ error: "Este código de invitación ya fue usado." });
      }

      // 3. Crear el usuario (Lógica estándar)
      const hashedPassword = await bcrypt.hash(password, 10);
      let creator;
      const authHeader = req.headers.authorization;

      // Lógica para migrar cuenta de invitado (si existiera)
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
          fastify.log.warn('Token de invitado inválido o expirado, creando nueva cuenta limpia.');
        }
      }

      // Si no era invitado, creamos uno nuevo desde cero
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

      // 4. QUEMAR EL CÓDIGO (Marcarlo como usado)
      // Esto es crucial para evitar que se comparta masivamente
      await prisma.inviteCode.update({
        where: { id: validInvite.id },
        data: { isUsed: true, usedBy: email }
      });

      // 5. Generar token y responder
      const newToken = fastify.generateToken(creator);
      reply.code(201).send({ 
        token: newToken, 
        publicId: creator.publicId, 
        name: creator.name, 
        dashboardId: creator.id 
      });

    } catch (e) {
      if (e.code === 'P2002') {
        return reply.code(409).send({ error: "El email ya está en uso." });
      }
      fastify.log.error(e);
      reply.code(500).send({ error: "Error al crear la cuenta" });
    }
  });

  // --- Endpoint para INICIAR SESIÓN ---
  fastify.post("/auth/login", async (req, reply) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return reply.code(400).send({ error: "Email y contraseña requeridos" });
    }

    try {
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
    } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({ error: "Error interno al iniciar sesión" });
    }
  });
}

module.exports = authRoutes;