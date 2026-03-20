-- CreateEnum
CREATE TYPE "FeedPostType" AS ENUM ('POST', 'GOAL', 'ASSIST', 'WIN', 'LOSS', 'CHECKIN', 'MVP');

-- CreateTable
CREATE TABLE "FeedPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT,
    "type" "FeedPostType" NOT NULL DEFAULT 'POST',
    "text" TEXT NOT NULL,
    "imageUrl" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedPost_userId_createdAt_idx" ON "FeedPost"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedPost_matchId_idx" ON "FeedPost"("matchId");

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
