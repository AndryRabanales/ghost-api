-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "priorityScore" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "baseTipAmountCents" INTEGER NOT NULL DEFAULT 10000;
