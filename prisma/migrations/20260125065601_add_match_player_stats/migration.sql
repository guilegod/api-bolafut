-- CreateTable
CREATE TABLE "MatchPlayerStat" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchPlayerStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchPlayerStat_userId_idx" ON "MatchPlayerStat"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayerStat_matchId_userId_key" ON "MatchPlayerStat"("matchId", "userId");

-- AddForeignKey
ALTER TABLE "MatchPlayerStat" ADD CONSTRAINT "MatchPlayerStat_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayerStat" ADD CONSTRAINT "MatchPlayerStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
