-- CreateEnum
CREATE TYPE "public"."Status" AS ENUM ('PENDING', 'FULFILLED', 'NOT_FULFILLED');

-- CreateEnum
CREATE TYPE "public"."RoundStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- AlterTable
ALTER TABLE "public"."Message" ADD COLUMN     "roundId" TEXT,
ADD COLUMN     "status" "public"."Status" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "public"."Round" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."RoundStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);
