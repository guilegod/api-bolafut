-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "accessPassword" TEXT,
ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Match_isPrivate_idx" ON "Match"("isPrivate");
