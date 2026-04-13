-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "peladaLocationId" TEXT;

-- CreateTable
CREATE TABLE "PeladaLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeladaLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeladaLocation_isActive_idx" ON "PeladaLocation"("isActive");

-- CreateIndex
CREATE INDEX "PeladaLocation_createdById_idx" ON "PeladaLocation"("createdById");

-- CreateIndex
CREATE INDEX "PeladaLocation_name_idx" ON "PeladaLocation"("name");

-- CreateIndex
CREATE INDEX "Match_peladaLocationId_idx" ON "Match"("peladaLocationId");

-- AddForeignKey
ALTER TABLE "PeladaLocation" ADD CONSTRAINT "PeladaLocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_peladaLocationId_fkey" FOREIGN KEY ("peladaLocationId") REFERENCES "PeladaLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
