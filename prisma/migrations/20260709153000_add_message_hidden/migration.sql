-- AlterTable: nota oculta del collage / tendedero público
ALTER TABLE "ChatMessage" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
