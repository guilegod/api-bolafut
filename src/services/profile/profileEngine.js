import { prisma } from "../../lib/prisma.js";

function getTierFromRating(rating) {
  if (rating < 100) return "Bronze";
  if (rating < 200) return "Prata";
  if (rating < 400) return "Ouro";
  if (rating < 700) return "Diamante";
  return "Elite";
}

function getNextTier(tier) {
  if (tier === "Bronze") return "Prata";
  if (tier === "Prata") return "Ouro";
  if (tier === "Ouro") return "Diamante";
  if (tier === "Diamante") return "Elite";
  return "Elite";
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function safeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveAvatarUrl(user) {
  return user?.profile?.avatarUrl || user?.imageUrl || "";
}

function resolveFeedAvatar(item) {
  return item?.user?.profile?.avatarUrl || item?.user?.imageUrl || "";
}

function buildAchievements(stats, history) {
  const matches = safeNumber(stats.matches);
  const goals = safeNumber(stats.goals);
  const assists = safeNumber(stats.assists);
  const wins = safeNumber(stats.wins);

  const streak = (() => {
    let current = 0;
    let best = 0;

    for (const item of history) {
      if (item.result === "win") {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }

    return best;
  })();

  return [
    {
      id: "first-match",
      icon: "⚽",
      title: "Primeira partida",
      description: "Participe da sua primeira partida.",
      rarity: "Comum",
      unlocked: matches >= 1,
      progress: clampProgress((matches / 1) * 100),
    },
    {
      id: "ten-matches",
      icon: "🔥",
      title: "Ritmo de jogo",
      description: "Complete 10 partidas.",
      rarity: "Raro",
      unlocked: matches >= 10,
      progress: clampProgress((matches / 10) * 100),
    },
    {
      id: "goal-machine",
      icon: "🥅",
      title: "Máquina de gols",
      description: "Marque 10 gols.",
      rarity: "Épico",
      unlocked: goals >= 10,
      progress: clampProgress((goals / 10) * 100),
    },
    {
      id: "playmaker",
      icon: "🎯",
      title: "Garçom",
      description: "Distribua 10 assistências.",
      rarity: "Raro",
      unlocked: assists >= 10,
      progress: clampProgress((assists / 10) * 100),
    },
    {
      id: "streak",
      icon: "🏆",
      title: "Sequência quente",
      description: "Conquiste 3 vitórias seguidas.",
      rarity: "Épico",
      unlocked: streak >= 3,
      progress: clampProgress((streak / 3) * 100),
    },
    {
      id: "winner",
      icon: "👑",
      title: "Casca grossa",
      description: "Conquiste 15 vitórias.",
      rarity: "Lendário",
      unlocked: wins >= 15,
      progress: clampProgress((wins / 15) * 100),
    },
  ];
}

function buildFallbackRank(stats) {
  const rating =
    safeNumber(stats.wins) * 12 +
    safeNumber(stats.goals) * 3 +
    safeNumber(stats.assists) * 2;

  const tier = getTierFromRating(rating);

  return {
    tier,
    rating,
    rankPosition: 0,
    nextTier: getNextTier(tier),
    progress: clampProgress(rating % 100),
    wins: safeNumber(stats.wins),
    losses: safeNumber(stats.losses),
    draws: safeNumber(stats.draws),
    matches: safeNumber(stats.matches),
    goals: safeNumber(stats.goals),
    assists: safeNumber(stats.assists),
    winStreak: 0,
    bestWinStreak: 0,
    season: "global",
  };
}

function buildRankFromPlayerRank(playerRank, stats) {
  if (!playerRank) {
    return buildFallbackRank(stats);
  }

  const rating = safeNumber(playerRank.rating, 1000);
  const tier = safeString(playerRank.tier, getTierFromRating(rating));

  return {
    tier,
    rating,
    rankPosition: safeNumber(playerRank.rankPosition),
    nextTier: getNextTier(tier),
    progress: clampProgress(playerRank.progress),
    wins: safeNumber(playerRank.wins),
    losses: safeNumber(playerRank.losses),
    draws: safeNumber(playerRank.draws),
    matches: safeNumber(playerRank.matches),
    goals: safeNumber(playerRank.goals),
    assists: safeNumber(playerRank.assists),
    winStreak: safeNumber(playerRank.winStreak),
    bestWinStreak: safeNumber(playerRank.bestWinStreak),
    mvpCount: safeNumber(playerRank.mvpCount),
    season: safeString(playerRank.season, "global"),
  };
}

function buildHistory(matchesPlayed, userId) {
  return matchesPlayed.map((match) => {
    const presence = match.presences.find((p) => p.userId === userId);

    let result = null;

    if (match.teamAScore === match.teamBScore && match.status === "FINISHED") {
      result = "draw";
    } else if (match.winnerSide && presence?.teamSide) {
      result = presence.teamSide === match.winnerSide ? "win" : "loss";
    }

    return {
      id: match.id,
      type: String(match.kind || "PELADA").toLowerCase(),
      status: String(match.status || "SCHEDULED").toLowerCase(),
      title: match.title,
      arena:
        match.court?.arena?.name ||
        match.manualArenaName ||
        match.peladaLocation?.name ||
        "Arena",
      address:
        match.court?.arena?.address ||
        match.manualAddress ||
        match.peladaLocation?.address ||
        "",
      date: match.date,
      result,
      teamSide: presence?.teamSide || null,
      score: `${safeNumber(match.teamAScore)} x ${safeNumber(match.teamBScore)}`,
      teamAName: match.teamAName || "Time A",
      teamBName: match.teamBName || "Time B",
      teamAScore: safeNumber(match.teamAScore),
      teamBScore: safeNumber(match.teamBScore),
      isPrivate: Boolean(match.isPrivate),
      isManualLocation: Boolean(match.isManualLocation),
    };
  });
}

export async function getUserProfileDashboardById(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      rank: true,
    },
  });

  if (!user) return null;

  const statRows = await prisma.matchPlayerStat.findMany({
    where: { userId },
  });

  const matchesPlayed = await prisma.match.findMany({
    where: {
      presences: {
        some: { userId },
      },
    },
    orderBy: { date: "desc" },
    include: {
      court: {
        include: {
          arena: true,
        },
      },
      peladaLocation: true,
      presences: {
        select: {
          userId: true,
          teamSide: true,
        },
      },
    },
  });

  const feed = await prisma.feedPost.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          profile: {
            select: {
              avatarUrl: true,
            },
          },
        },
      },
    },
  });

  const stats = statRows.reduce(
    (acc, row) => {
      acc.matches += 1;
      acc.wins += safeNumber(row.wins);
      acc.losses += safeNumber(row.losses);
      acc.draws += safeNumber(row.draws);
      acc.goals += safeNumber(row.goalsOfficial) + safeNumber(row.goalsUnofficial);
      acc.assists +=
        safeNumber(row.assistsOfficial) + safeNumber(row.assistsUnofficial);
      return acc;
    },
    {
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      goals: 0,
      assists: 0,
    }
  );

  const history = buildHistory(matchesPlayed, userId);
  const rank = buildRankFromPlayerRank(user.rank, stats);
  const achievements = buildAchievements(stats, history);

  return {
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      avatarUrl: resolveAvatarUrl(user),
      baseAvatarUrl: user.imageUrl || "",
      role: user.role,
      isPremium: Boolean(user.isPremium),
      premiumUntil: user.premiumUntil || null,
      createdAt: user.createdAt,

      city: user.profile?.city || "Curitiba - PR",
      bio: user.profile?.bio || "",
      position: user.profile?.position || "MEI",
      foot: user.profile?.foot || "Destro",
      username: user.profile?.username || null,
      level: user.profile?.level || null,
      bairro: user.profile?.bairro || "",
      coverImageUrl: user.profile?.coverImageUrl || "",

      // novos campos premium / visual
      profileAvatarUrl: user.profile?.avatarUrl || "",
      avatarFrame: user.profile?.avatarFrame || "",
      profileTheme: user.profile?.profileTheme || "default",
      bannerType: user.profile?.bannerType || "STATIC",
      bannerAnimatedUrl: user.profile?.bannerAnimatedUrl || "",
      bannerVideoUrl: user.profile?.bannerVideoUrl || "",
      bannerOverlay: user.profile?.bannerOverlay || "",
      bannerPosition: user.profile?.bannerPosition || "",
      showPremiumBadge: Boolean(user.profile?.showPremiumBadge),
      equippedBadge: user.profile?.equippedBadge || "",
      glowEffect: user.profile?.glowEffect || "",
      cardEffect: user.profile?.cardEffect || "",
    },

    stats,

    rank,

    history,

    achievements,

    feed: feed.map((item) => ({
      id: item.id,
      type: String(item.type || "POST").toLowerCase(),
      text: item.text,
      image: item.imageUrl || "",
      createdAt: item.createdAt,
      userId: item.userId,
      user: {
        id: item.user?.id || item.userId,
        name: item.user?.name || "Jogador",
        avatar: resolveFeedAvatar(item),
      },
      meta: item.meta || {},
    })),
  };
}