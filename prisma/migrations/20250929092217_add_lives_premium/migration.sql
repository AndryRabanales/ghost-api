-- AlterTable
ALTER TABLE "public"."Creator" ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastRefillAt" TIMESTAMP(3),
ADD COLUMN     "lives" INTEGER NOT NULL DEFAULT 5;
