// routes/admin.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function adminRoutes(fastify, opts) {
  
  // ... (ruta POST /admin/set-premium se mantiene) ...

  /**
   * NUEVA RUTA (P3): Simulación de Cron Job para Reembolsos por Ausencia.
   * Marca como 'NOT_FULFILLED' los pagos PENDING con más de 72 horas.
   */
  fastify.post(
    '/admin/check-refunds',
    // SOLO accesible con la API Key de Admin (P5)
    { preHandler: [fastify.adminAuthenticate] }, 
    async (req, reply) => {

      // Tiempo límite: 72 horas antes de ahora
      const seventyTwoHoursAgo = new Date(Date.now() - (72 * 60 * 60 * 1000));

      try {
        const outdatedTips = await prisma.chatMessage.findMany({
          where: {
            tipStatus: 'PENDING',
            createdAt: {
              lt: seventyTwoHoursAgo, // Creado antes del límite de 72 horas
            },
            tipAmount: {
                gt: 0 // Solo procesamos pagos Premium (con propina)
            }
          },
        });
        
        if (outdatedTips.length === 0) {
            fastify.log.info("Cron: No se encontraron pagos expirados para reembolsar.");
            return reply.send({ success: true, count: 0, message: "No se encontraron pagos pendientes de reembolso." });
        }

        // Actualizar el estado a NOT_FULFILLED (Reembolso)
        const updateResult = await prisma.chatMessage.updateMany({
            where: {
                id: { in: outdatedTips.map(t => t.id) }
            },
            data: {
                tipStatus: 'NOT_FULFILLED', // <--- P3: Marcar como No Cumplido/Reembolsable
            }
        });
        
        // NOTA: Aquí se integraría la API real de Stripe/MercadoPago para devolver el dinero.
        // En este MVP, solo marcamos la DB para que se refleje en el Balance (P5).

        fastify.log.warn(`Cron: ✅ ${updateResult.count} pago(s) marcado(s) como NOT_FULFILLED (Reembolsable).`);
        
        reply.send({ 
            success: true, 
            count: updateResult.count, 
            message: `Reembolso simulado para ${updateResult.count} pago(s).`
        });

      } catch (err) {
        fastify.log.error(err, "Error al ejecutar el cron de reembolsos");
        reply.code(500).send({ error: 'Error interno en el cron job' });
      }
    }
  );
}

module.exports = adminRoutes;