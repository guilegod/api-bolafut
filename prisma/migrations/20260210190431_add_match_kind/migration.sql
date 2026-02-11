-- CreateEnum
CREATE TYPE "MatchKind" AS ENUM ('BOOKING', 'PELADA');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "kind" "MatchKind" NOT NULL DEFAULT 'BOOKING';

-- CreateIndex
CREATE INDEX "Match_kind_idx" ON "Match"("kind");
