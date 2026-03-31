-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "isManualLocation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manualAddress" TEXT,
ADD COLUMN     "manualArenaName" TEXT,
ALTER COLUMN "courtId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Match_isManualLocation_idx" ON "Match"("isManualLocation");
