/*
  Warnings:

  - You are about to drop the column `lives` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `maxLives` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSubscriptionId` on the `Creator` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."Creator_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "Creator" DROP COLUMN "lives",
DROP COLUMN "maxLives",
DROP COLUMN "stripeSubscriptionId";
