const fp = require("fastify-plugin");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function cronPlugin(fastify, opts) {
    // Función para limpiar chats expirados
    const cleanupExpiredChats = async () => {
        try {
            const now = new Date();
            // Eliminar chats donde expiresAt es menor o igual a AHORA
            // NOTA: Como definimos cascade en schema.prisma, los mensajes se borrarán automáticamente.
            const result = await prisma.chat.deleteMany({
                where: {
                    expiresAt: {
                        lte: now
                    }
                }
            });

            if (result.count > 0) {
                fastify.log.info(`🧹 Limpieza: Se han eliminado ${result.count} chats expirados permanentemente.`);
            }
        } catch (err) {
            fastify.log.error("❌ Error en el cron de limpieza de chats expirados:", err);
        }
    };

    // Ejecutar el cleanup inmediatamente al arrancar el servidor
    cleanupExpiredChats();

    // Ejecutar el cleanup cada minuto
    const interval = setInterval(cleanupExpiredChats, 60 * 1000);

    // Limpiar el intervalo cuando el servidor se cierre
    fastify.addHook('onClose', (instance, done) => {
        clearInterval(interval);
        done();
    });
}

module.exports = fp(cronPlugin, {
    name: "chat-expiration-cron",
});
