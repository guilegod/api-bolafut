-- CreateTable
CREATE TABLE "MatchPresence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchPresence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchPresence_matchId_idx" ON "MatchPresence"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPresence_userId_matchId_key" ON "MatchPresence"("userId", "matchId");

-- AddForeignKey
ALTER TABLE "MatchPresence" ADD CONSTRAINT "MatchPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPresence" ADD CONSTRAINT "MatchPresence_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
