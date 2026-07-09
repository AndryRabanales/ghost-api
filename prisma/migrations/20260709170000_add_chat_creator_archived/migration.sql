-- AlterTable: el creador archivó el chat (se oculta de su bandeja)
ALTER TABLE "Chat" ADD COLUMN "creatorArchived" BOOLEAN NOT NULL DEFAULT false;
