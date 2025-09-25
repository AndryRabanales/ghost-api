/*
  Warnings:

  - You are about to drop the column `roundId` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the `Round` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Message" DROP COLUMN "roundId";

-- DropTable
DROP TABLE "public"."Round";

-- DropEnum
DROP TYPE "public"."RoundStatus";
