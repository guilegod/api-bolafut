/*
  Warnings:

  - You are about to drop the column `assists` on the `MatchPlayerStat` table. All the data in the column will be lost.
  - You are about to drop the column `goals` on the `MatchPlayerStat` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MatchPlayerStat" DROP COLUMN "assists",
DROP COLUMN "goals",
ADD COLUMN     "assistsOfficial" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "assistsUnofficial" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "goalsOfficial" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "goalsUnofficial" INTEGER NOT NULL DEFAULT 0;
