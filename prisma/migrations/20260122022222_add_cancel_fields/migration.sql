-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "isCanceled" BOOLEAN NOT NULL DEFAULT false;
