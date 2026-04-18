-- CreateEnum
CREATE TYPE "ProfileBannerType" AS ENUM ('STATIC', 'GIF', 'VIDEO', 'THEME');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "avatarFrame" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "bannerAnimatedUrl" TEXT,
ADD COLUMN     "bannerOverlay" TEXT,
ADD COLUMN     "bannerPosition" TEXT,
ADD COLUMN     "bannerType" "ProfileBannerType" NOT NULL DEFAULT 'STATIC',
ADD COLUMN     "bannerVideoUrl" TEXT,
ADD COLUMN     "cardEffect" TEXT,
ADD COLUMN     "equippedBadge" TEXT,
ADD COLUMN     "glowEffect" TEXT,
ADD COLUMN     "profileTheme" TEXT DEFAULT 'default',
ADD COLUMN     "showPremiumBadge" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "premiumUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Profile_profileTheme_idx" ON "Profile"("profileTheme");

-- CreateIndex
CREATE INDEX "Profile_bannerType_idx" ON "Profile"("bannerType");

-- CreateIndex
CREATE INDEX "User_isPremium_idx" ON "User"("isPremium");

-- CreateIndex
CREATE INDEX "User_premiumUntil_idx" ON "User"("premiumUntil");
