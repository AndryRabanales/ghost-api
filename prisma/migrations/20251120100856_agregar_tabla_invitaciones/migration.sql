/*
  Warnings:

  - You are about to drop the column `isPremium` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `lastUpdated` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `premiumExpiresAt` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `stripeCustomerId` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSubscriptionStatus` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `tipOnlyMode` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the `Message` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Payment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Response` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Message" DROP CONSTRAINT "Message_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Response" DROP CONSTRAINT "Response_messageId_fkey";

-- DropIndex
DROP INDEX "public"."Creator_stripeCustomerId_key";

-- AlterTable
ALTER TABLE "Creator" DROP COLUMN "isPremium",
DROP COLUMN "lastUpdated",
DROP COLUMN "premiumExpiresAt",
DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeSubscriptionStatus",
DROP COLUMN "tipOnlyMode",
DROP COLUMN "updatedAt",
ALTER COLUMN "lastActive" DROP DEFAULT,
ALTER COLUMN "premiumContract" SET DEFAULT 'Respuesta garantizada.',
ALTER COLUMN "topicPreference" SET DEFAULT 'Cualquier tema.';

-- DropTable
DROP TABLE "public"."Message";

-- DropTable
DROP TABLE "public"."Payment";

-- DropTable
DROP TABLE "public"."Response";

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "usedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");
