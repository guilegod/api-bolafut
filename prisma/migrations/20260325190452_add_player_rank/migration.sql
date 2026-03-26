-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "rankProcessed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PlayerRank" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1000,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "mvpCount" INTEGER NOT NULL DEFAULT 0,
    "winStreak" INTEGER NOT NULL DEFAULT 0,
    "bestWinStreak" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'Bronze',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "rankPosition" INTEGER NOT NULL DEFAULT 0,
    "season" TEXT NOT NULL DEFAULT 'global',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerRank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRank_userId_key" ON "PlayerRank"("userId");

-- CreateIndex
CREATE INDEX "PlayerRank_rating_idx" ON "PlayerRank"("rating");

-- CreateIndex
CREATE INDEX "PlayerRank_tier_idx" ON "PlayerRank"("tier");

-- CreateIndex
CREATE INDEX "PlayerRank_season_rating_idx" ON "PlayerRank"("season", "rating");

-- CreateIndex
CREATE INDEX "Match_rankProcessed_idx" ON "Match"("rankProcessed");

-- AddForeignKey
ALTER TABLE "PlayerRank" ADD CONSTRAINT "PlayerRank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
