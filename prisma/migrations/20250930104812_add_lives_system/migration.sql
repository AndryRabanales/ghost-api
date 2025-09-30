/*
  Warnings:

  - You are about to drop the column `lastRefillAt` on the `Creator` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Creator" DROP COLUMN "lastRefillAt",
ADD COLUMN     "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "maxLives" INTEGER NOT NULL DEFAULT 6,
ALTER COLUMN "lives" SET DEFAULT 6;
