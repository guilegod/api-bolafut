import express from "express";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import { getUserProfileDashboardById } from "../services/profile/profileEngine.js";

const router = express.Router();

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeNullableString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

function isPremiumActive(user) {
  if (!user?.isPremium) return false;
  if (!user?.premiumUntil) return true;
  return new Date(user.premiumUntil) > new Date();
}

/**
 * GET /users/me/profile
 */
router.get("/me/profile", authRequired, async (req, res, next) => {
  try {
    const meId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: meId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        imageUrl: true,
        role: true,
        isPremium: true,
        premiumUntil: true,
        createdAt: true,
        profile: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /users/me/dashboard
 */
router.get("/me/dashboard", authRequired, async (req, res, next) => {
  try {
    const data = await getUserProfileDashboardById(req.user.id);

    if (!data) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /users/:id/dashboard
 */
router.get("/:id/dashboard", authRequired, async (req, res, next) => {
  try {
    const data = await getUserProfileDashboardById(req.params.id);

    if (!data) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /users/me/profile
 */
router.patch("/me/profile", authRequired, async (req, res, next) => {
  try {
    const meId = req.user.id;

    const {
      name,
      phone,
      imageUrl,

      bio,
      city,
      bairro,
      position,
      foot,
      username,
      coverImageUrl,
      level,
      tags,

      // novos campos premium / visual
      avatarUrl,
      avatarFrame,
      profileTheme,
      bannerType,
      bannerAnimatedUrl,
      bannerVideoUrl,
      bannerOverlay,
      bannerPosition,
      showPremiumBadge,
      equippedBadge,
      glowEffect,
      cardEffect,
    } = req.body || {};

    if (typeof name === "string" && !name.trim()) {
      return res.status(400).json({ message: "Nome inválido" });
    }

    if (typeof username === "string" && username.trim()) {
      const exists = await prisma.profile.findFirst({
        where: {
          username: username.trim(),
          NOT: { userId: meId },
        },
        select: { id: true },
      });

      if (exists) {
        return res.status(409).json({ message: "Username já está em uso" });
      }
    }

    const me = await prisma.user.findUnique({
      where: { id: meId },
      select: {
        id: true,
        isPremium: true,
        premiumUntil: true,
      },
    });

    if (!me) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const premiumActive = isPremiumActive(me);

    const premiumFieldsWereSent =
      avatarUrl !== undefined ||
      avatarFrame !== undefined ||
      profileTheme !== undefined ||
      bannerType !== undefined ||
      bannerAnimatedUrl !== undefined ||
      bannerVideoUrl !== undefined ||
      bannerOverlay !== undefined ||
      bannerPosition !== undefined ||
      showPremiumBadge !== undefined ||
      equippedBadge !== undefined ||
      glowEffect !== undefined ||
      cardEffect !== undefined;

    if (!premiumActive && premiumFieldsWereSent) {
      const tryingAnimatedBanner =
        bannerType === "GIF" ||
        bannerType === "VIDEO" ||
        isNonEmptyString(bannerAnimatedUrl) ||
        isNonEmptyString(bannerVideoUrl);

      const tryingPremiumVisual =
        isNonEmptyString(avatarFrame) ||
        isNonEmptyString(profileTheme) ||
        isNonEmptyString(equippedBadge) ||
        isNonEmptyString(glowEffect) ||
        isNonEmptyString(cardEffect) ||
        showPremiumBadge === true ||
        isNonEmptyString(avatarUrl);

      if (tryingAnimatedBanner || tryingPremiumVisual) {
        return res.status(403).json({
          message: "Recurso premium necessário",
        });
      }
    }

    await prisma.user.update({
      where: { id: meId },
      data: {
        ...(typeof name === "string" ? { name: name.trim() } : {}),
        ...(typeof phone === "string" ? { phone: phone.trim() } : {}),
        ...(typeof imageUrl === "string" ? { imageUrl: imageUrl.trim() } : {}),
      },
    });

    await prisma.profile.upsert({
      where: { userId: meId },
      create: {
        userId: meId,

        ...(typeof username === "string"
          ? { username: username.trim() || null }
          : {}),
        ...(typeof bio === "string" ? { bio: bio.trim() } : {}),
        ...(typeof city === "string" ? { city: city.trim() } : {}),
        ...(typeof bairro === "string" ? { bairro: bairro.trim() } : {}),
        ...(typeof position === "string" ? { position: position.trim() } : {}),
        ...(typeof foot === "string" ? { foot: foot.trim() } : {}),
        ...(typeof coverImageUrl === "string"
          ? { coverImageUrl: coverImageUrl.trim() }
          : {}),
        ...(typeof level === "string" ? { level: level.trim() } : {}),
        ...(tags !== undefined ? { tags } : {}),

        // novos campos premium / visual
        ...(typeof avatarUrl === "string"
          ? { avatarUrl: avatarUrl.trim() }
          : {}),
        ...(avatarFrame !== undefined
          ? { avatarFrame: normalizeNullableString(avatarFrame) }
          : {}),
        ...(profileTheme !== undefined
          ? { profileTheme: normalizeNullableString(profileTheme) || "default" }
          : {}),
        ...(bannerType !== undefined ? { bannerType } : {}),
        ...(bannerAnimatedUrl !== undefined
          ? { bannerAnimatedUrl: normalizeNullableString(bannerAnimatedUrl) }
          : {}),
        ...(bannerVideoUrl !== undefined
          ? { bannerVideoUrl: normalizeNullableString(bannerVideoUrl) }
          : {}),
        ...(bannerOverlay !== undefined
          ? { bannerOverlay: normalizeNullableString(bannerOverlay) }
          : {}),
        ...(bannerPosition !== undefined
          ? { bannerPosition: normalizeNullableString(bannerPosition) }
          : {}),
        ...(typeof showPremiumBadge === "boolean"
          ? { showPremiumBadge }
          : {}),
        ...(equippedBadge !== undefined
          ? { equippedBadge: normalizeNullableString(equippedBadge) }
          : {}),
        ...(glowEffect !== undefined
          ? { glowEffect: normalizeNullableString(glowEffect) }
          : {}),
        ...(cardEffect !== undefined
          ? { cardEffect: normalizeNullableString(cardEffect) }
          : {}),
      },
      update: {
        ...(typeof username === "string"
          ? { username: username.trim() || null }
          : {}),
        ...(typeof bio === "string" ? { bio: bio.trim() } : {}),
        ...(typeof city === "string" ? { city: city.trim() } : {}),
        ...(typeof bairro === "string" ? { bairro: bairro.trim() } : {}),
        ...(typeof position === "string" ? { position: position.trim() } : {}),
        ...(typeof foot === "string" ? { foot: foot.trim() } : {}),
        ...(typeof coverImageUrl === "string"
          ? { coverImageUrl: coverImageUrl.trim() }
          : {}),
        ...(typeof level === "string" ? { level: level.trim() } : {}),
        ...(tags !== undefined ? { tags } : {}),

        // novos campos premium / visual
        ...(typeof avatarUrl === "string"
          ? { avatarUrl: avatarUrl.trim() }
          : {}),
        ...(avatarFrame !== undefined
          ? { avatarFrame: normalizeNullableString(avatarFrame) }
          : {}),
        ...(profileTheme !== undefined
          ? { profileTheme: normalizeNullableString(profileTheme) || "default" }
          : {}),
        ...(bannerType !== undefined ? { bannerType } : {}),
        ...(bannerAnimatedUrl !== undefined
          ? { bannerAnimatedUrl: normalizeNullableString(bannerAnimatedUrl) }
          : {}),
        ...(bannerVideoUrl !== undefined
          ? { bannerVideoUrl: normalizeNullableString(bannerVideoUrl) }
          : {}),
        ...(bannerOverlay !== undefined
          ? { bannerOverlay: normalizeNullableString(bannerOverlay) }
          : {}),
        ...(bannerPosition !== undefined
          ? { bannerPosition: normalizeNullableString(bannerPosition) }
          : {}),
        ...(typeof showPremiumBadge === "boolean"
          ? { showPremiumBadge }
          : {}),
        ...(equippedBadge !== undefined
          ? { equippedBadge: normalizeNullableString(equippedBadge) }
          : {}),
        ...(glowEffect !== undefined
          ? { glowEffect: normalizeNullableString(glowEffect) }
          : {}),
        ...(cardEffect !== undefined
          ? { cardEffect: normalizeNullableString(cardEffect) }
          : {}),
      },
    });

    const updated = await prisma.user.findUnique({
      where: { id: meId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        imageUrl: true,
        role: true,
        isPremium: true,
        premiumUntil: true,
        createdAt: true,
        profile: true,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;