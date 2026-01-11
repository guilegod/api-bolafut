-- CreateEnum
CREATE TYPE "CourtType" AS ENUM ('FUTSAL', 'FUT7');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'arena_owner';

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_courtId_fkey";

-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "arenaOwnerId" TEXT,
ADD COLUMN     "type" "CourtType" NOT NULL DEFAULT 'FUTSAL';

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "matchAddress" TEXT,
ADD COLUMN     "maxPlayers" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "pricePerPlayer" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "type" "CourtType" NOT NULL DEFAULT 'FUTSAL',
ALTER COLUMN "courtId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PartnerArena" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerArena_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerArena_organizerId_courtId_key" ON "PartnerArena"("organizerId", "courtId");

-- AddForeignKey
ALTER TABLE "Court" ADD CONSTRAINT "Court_arenaOwnerId_fkey" FOREIGN KEY ("arenaOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerArena" ADD CONSTRAINT "PartnerArena_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerArena" ADD CONSTRAINT "PartnerArena_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;
