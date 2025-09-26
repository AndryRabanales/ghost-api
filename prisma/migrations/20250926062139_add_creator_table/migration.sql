/*
  Warnings:

  - You are about to drop the column `seen` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Message` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Message" DROP COLUMN "seen",
DROP COLUMN "userId";

-- CreateTable
CREATE TABLE "public"."Creator" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_publicId_key" ON "public"."Creator"("publicId");

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
