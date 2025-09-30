// utils/validators.js

/**
 * Validación para crear un Creator (dashboard)
 */
const createCreatorSchema = {
    body: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
      },
    },
  };
  
  /**
   * Validación para login de Creator
   */
  const loginCreatorSchema = {
    body: {
      type: "object",
      required: ["publicId"],
      properties: {
        publicId: { type: "string", minLength: 1 },
      },
    },
  };
  
  /**
   * Validación para crear un Chat
   */
  const createChatSchema = {
    body: {
      type: "object",
      required: ["publicId", "content"],
      properties: {
        publicId: { type: "string" },
        content: { type: "string", minLength: 1 },
        alias: { type: "string" },
      },
    },
  };
  
  /**
   * Validación para enviar un mensaje anónimo
   */
  const anonMessageSchema = {
    body: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string", minLength: 1 },
        alias: { type: "string" },
      },
    },
  };
  
  /**
   * Validación para responder un chat desde el creador
   */
  const creatorMessageSchema = {
    body: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string", minLength: 1 },
      },
    },
  };
  
  module.exports = {
    createCreatorSchema,
    loginCreatorSchema,
    createChatSchema,
    anonMessageSchema,
    creatorMessageSchema,
  };
  