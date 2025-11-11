-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "dailyMsgLimit" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "msgCountLastReset" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "msgCountToday" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "premiumContract" TEXT DEFAULT 'Respuesta de alta calidad.';
