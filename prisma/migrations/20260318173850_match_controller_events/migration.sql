-- CreateEnum
CREATE TYPE "TeamSide" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "MatchEventType" AS ENUM ('GOAL', 'MVP', 'START', 'END');

-- CreateEnum
CREATE TYPE "MatchEventStatus" AS ENUM ('CONFIRMED', 'REMOVED', 'CONTESTED');

-- CreateEnum
CREATE TYPE "PixProvider" AS ENUM ('OPENPIX');

-- CreateEnum
CREATE TYPE "PixPaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'EXPIRED', 'CANCELED', 'ERROR');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "controllerId" TEXT,
ADD COLUMN     "teamAName" TEXT,
ADD COLUMN     "teamAScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "teamBName" TEXT,
ADD COLUMN     "teamBScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "winnerSide" "TeamSide";

-- AlterTable
ALTER TABLE "MatchPlayerStat" ADD COLUMN     "wins" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MatchPresence" ADD COLUMN     "isCaptain" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "teamSide" "TeamSide";

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "type" "MatchEventType" NOT NULL,
    "status" "MatchEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "teamSide" "TeamSide",
    "playerId" TEXT,
    "assistPlayerId" TEXT,
    "minute" INTEGER,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixPayment" (
    "id" TEXT NOT NULL,
    "provider" "PixProvider" NOT NULL DEFAULT 'OPENPIX',
    "status" "PixPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "reservationId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "chargeId" TEXT,
    "txid" TEXT,
    "value" INTEGER NOT NULL,
    "brCode" TEXT,
    "qrCodeImage" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_idx" ON "MatchEvent"("matchId");

-- CreateIndex
CREATE INDEX "MatchEvent_playerId_idx" ON "MatchEvent"("playerId");

-- CreateIndex
CREATE INDEX "MatchEvent_assistPlayerId_idx" ON "MatchEvent"("assistPlayerId");

-- CreateIndex
CREATE INDEX "MatchEvent_type_idx" ON "MatchEvent"("type");

-- CreateIndex
CREATE INDEX "MatchEvent_status_idx" ON "MatchEvent"("status");

-- CreateIndex
CREATE INDEX "MatchEvent_teamSide_idx" ON "MatchEvent"("teamSide");

-- CreateIndex
CREATE UNIQUE INDEX "PixPayment_reservationId_key" ON "PixPayment"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "PixPayment_correlationId_key" ON "PixPayment"("correlationId");

-- CreateIndex
CREATE INDEX "PixPayment_chargeId_idx" ON "PixPayment"("chargeId");

-- CreateIndex
CREATE INDEX "PixPayment_txid_idx" ON "PixPayment"("txid");

-- CreateIndex
CREATE INDEX "Match_controllerId_idx" ON "Match"("controllerId");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "MatchMessage_userId_idx" ON "MatchMessage"("userId");

-- CreateIndex
CREATE INDEX "MatchPlayerStat_matchId_idx" ON "MatchPlayerStat"("matchId");

-- CreateIndex
CREATE INDEX "MatchPresence_matchId_idx" ON "MatchPresence"("matchId");

-- CreateIndex
CREATE INDEX "MatchPresence_teamSide_idx" ON "MatchPresence"("teamSide");

-- CreateIndex
CREATE INDEX "Reservation_courtId_endAt_idx" ON "Reservation"("courtId", "endAt");

-- CreateIndex
CREATE INDEX "Reservation_courtId_status_idx" ON "Reservation"("courtId", "status");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_assistPlayerId_fkey" FOREIGN KEY ("assistPlayerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixPayment" ADD CONSTRAINT "PixPayment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
