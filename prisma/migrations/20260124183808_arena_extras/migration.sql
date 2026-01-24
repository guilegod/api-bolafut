-- AlterTable
ALTER TABLE "Arena" ADD COLUMN     "amenities" JSONB,
ADD COLUMN     "hasLighting" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasLockerRoom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasParking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pixKey" TEXT,
ADD COLUMN     "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "capacity" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "covered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pricePerHour" INTEGER,
ADD COLUMN     "surface" TEXT;

-- CreateIndex
CREATE INDEX "Court_arenaId_idx" ON "Court"("arenaId");

-- CreateIndex
CREATE INDEX "Court_arenaOwnerId_idx" ON "Court"("arenaOwnerId");

-- CreateIndex
CREATE INDEX "Match_date_idx" ON "Match"("date");

-- CreateIndex
CREATE INDEX "Match_organizerId_idx" ON "Match"("organizerId");

-- CreateIndex
CREATE INDEX "Match_courtId_idx" ON "Match"("courtId");

-- CreateIndex
CREATE INDEX "MatchMessage_matchId_idx" ON "MatchMessage"("matchId");

-- CreateIndex
CREATE INDEX "MatchPresence_userId_idx" ON "MatchPresence"("userId");

-- CreateIndex
CREATE INDEX "PartnerArena_organizerId_idx" ON "PartnerArena"("organizerId");

-- CreateIndex
CREATE INDEX "PartnerArena_arenaId_idx" ON "PartnerArena"("arenaId");

-- AddForeignKey
ALTER TABLE "PartnerArena" ADD CONSTRAINT "PartnerArena_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
