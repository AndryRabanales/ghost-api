/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `Creator` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[subscriptionId]` on the table `Creator` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "email" TEXT,
ADD COLUMN     "password" TEXT,
ADD COLUMN     "premiumExpiresAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Creator_email_key" ON "Creator"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_subscriptionId_key" ON "Creator"("subscriptionId");
