// routes/auth.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient(); // ✨ CORRECCIÓN AQUÍ
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function authRoutes(fastify, opts) {
  // --- Endpoint para INICIAR SESIÓN / REGISTRARSE con Google ---
  fastify.post("/auth/google", async (req, reply) => {
    const { credential } = req.body;

    if (!credential) {
      return reply.code(400).send({ error: "Falta el token de Google" });
    }

    // Client IDs aceptados: web + app nativa (iOS/Android).
    // El client_id web es público (va en el frontend); lo dejamos como respaldo
    // para que el login web NUNCA se rompa aunque falte la variable en el server.
    const WEB_CLIENT_ID =
      "139854990044-ihq8knm8q3nk39vc5oebuorikdc01u14.apps.googleusercontent.com";
    // Cliente Android nativo (creado en Google Cloud, firma SHA-1 de la app).
    // Hardcodeado como respaldo para que el login de la app no dependa de una
    // variable en Railway (el client_id no es secreto, va en el frontend).
    const ANDROID_CLIENT_ID =
      "139854990044-gukj9a90rb2mpd745b6ovfiinj8socon.apps.googleusercontent.com";
    const audience = [
      process.env.GOOGLE_CLIENT_ID || WEB_CLIENT_ID,
      process.env.GOOGLE_IOS_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID || ANDROID_CLIENT_ID,
    ].filter(Boolean);

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience,
      });
      const payload = ticket.getPayload();

      if (!payload?.email) {
        return reply.code(401).send({ error: "Token de Google inválido" });
      }
      if (!payload.email_verified) {
        return reply.code(403).send({ error: "El email de Google no está verificado" });
      }

      let creator = await prisma.creator.findUnique({ where: { email: payload.email } });

      if (!creator) {
        creator = await prisma.creator.create({
          data: {
            id: crypto.randomUUID(),
            publicId: crypto.randomUUID(),
            name: payload.name || payload.email.split("@")[0],
            email: payload.email,
            password: null,
          },
        });
      }

      const token = fastify.generateToken(creator);
      reply.send({ token, publicId: creator.publicId, name: creator.name, dashboardId: creator.id });
    } catch (err) {
      // Registramos el motivo real para diagnosticar (aud mismatch, expirado, etc.).
      const raw = String(err?.message || "");
      fastify.log.error({ msg: "Fallo /auth/google", detail: raw });

      // Mensaje accionable según el tipo de fallo.
      let error = "Token de Google inválido";
      if (/wrong recipient|audience/i.test(raw)) {
        error = "Este dominio no está autorizado en Google. Reintenta o avísanos.";
      } else if (/expired|used too late|used too early|not yet valid/i.test(raw)) {
        error = "La sesión de Google caducó. Toca de nuevo “Continuar con Google”.";
      }
      reply.code(401).send({ error, detail: raw.slice(0, 120) });
    }
  });

  // --- Endpoint para REGISTRAR un nuevo usuario ---
  fastify.post("/auth/register", async (req, reply) => {
    // ... (el resto del código de registro se queda igual)
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return reply.code(400).send({ error: "Nombre, email y contraseña son obligatorios" });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
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

  // --- Endpoint para INICIAR SESIÓN ---
  fastify.post("/auth/login", async (req, reply) => {
    // ... (el código de login se queda igual)
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

  // --- Endpoint para REFRESCAR TOKEN ---
  fastify.post("/refresh-token", async (req, reply) => {
    const { publicId } = req.body;

    if (!publicId) {
      return reply.code(400).send({ error: "publicId requerido" });
    }

    try {
      const creator = await prisma.creator.findUnique({ where: { publicId } });
      if (!creator) {
        return reply.code(404).send({ error: "Usuario no encontrado" });
      }

      const token = fastify.generateToken(creator);
      reply.send({ token });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Error renovando token" });
    }
  });
}

module.exports = authRoutes;