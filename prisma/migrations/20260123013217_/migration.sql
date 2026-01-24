/*
  Warnings:

  - You are about to drop the column `canceledAt` on the `Match` table. All the data in the column will be lost.
  - You are about to drop the column `isCanceled` on the `Match` table. All the data in the column will be lost.
  - You are about to drop the column `courtId` on the `PartnerArena` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[matchId,userId]` on the table `MatchPresence` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organizerId,arenaId]` on the table `PartnerArena` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `arenaId` to the `PartnerArena` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CourtType" ADD VALUE 'CAMPO';
ALTER TYPE "CourtType" ADD VALUE 'VOLEI';
ALTER TYPE "CourtType" ADD VALUE 'FUTVOLEI';
ALTER TYPE "CourtType" ADD VALUE 'BEACH_TENNIS';
ALTER TYPE "CourtType" ADD VALUE 'BASQUETE';
ALTER TYPE "CourtType" ADD VALUE 'TENIS';
ALTER TYPE "CourtType" ADD VALUE 'HANDEBOL';
ALTER TYPE "CourtType" ADD VALUE 'SKATE';
ALTER TYPE "CourtType" ADD VALUE 'OUTRO';

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_organizerId_fkey";

-- DropForeignKey
ALTER TABLE "PartnerArena" DROP CONSTRAINT "PartnerArena_courtId_fkey";

-- DropForeignKey
ALTER TABLE "PartnerArena" DROP CONSTRAINT "PartnerArena_organizerId_fkey";

-- DropIndex
DROP INDEX "MatchPresence_matchId_idx";

-- DropIndex
DROP INDEX "MatchPresence_userId_matchId_key";

-- DropIndex
DROP INDEX "PartnerArena_organizerId_courtId_key";

-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "arenaId" TEXT;

-- AlterTable
ALTER TABLE "Match" DROP COLUMN "canceledAt",
DROP COLUMN "isCanceled",
ALTER COLUMN "type" SET DEFAULT 'FUT7';

-- AlterTable
ALTER TABLE "MatchPresence" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'confirmed';

-- AlterTable
ALTER TABLE "PartnerArena" DROP COLUMN "courtId",
ADD COLUMN     "arenaId" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "Arena" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "district" TEXT,
    "address" TEXT,
    "imageUrl" TEXT,
    "openTime" TEXT,
    "closeTime" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Arena_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchMessage" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Arena_ownerId_idx" ON "Arena"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPresence_matchId_userId_key" ON "MatchPresence"("matchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerArena_organizerId_arenaId_key" ON "PartnerArena"("organizerId", "arenaId");

-- AddForeignKey
ALTER TABLE "Arena" ADD CONSTRAINT "Arena_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Court" ADD CONSTRAINT "Court_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchMessage" ADD CONSTRAINT "MatchMessage_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchMessage" ADD CONSTRAINT "MatchMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerArena" ADD CONSTRAINT "PartnerArena_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
