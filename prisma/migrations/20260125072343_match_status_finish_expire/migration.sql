-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'CANCELED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "minPlayers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED';
