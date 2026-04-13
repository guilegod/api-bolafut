import { prisma } from "../lib/prisma.js";

export function getTierFromRating(rating = 1000) {
  if (rating >= 2200) return "Elite";
  if (rating >= 1800) return "Diamante";
  if (rating >= 1450) return "Ouro";
  if (rating >= 1150) return "Prata";
  return "Bronze";
}

export function getNextTier(currentTier = "Bronze") {
  switch (currentTier) {
    case "Bronze":
      return "Prata";
    case "Prata":
      return "Ouro";
    case "Ouro":
      return "Diamante";
    case "Diamante":
      return "Elite";
    default:
      return "Elite";
  }
}

export function getTierBounds(tier = "Bronze") {
  switch (tier) {
    case "Bronze":
      return { min: 0, max: 1149 };
    case "Prata":
      return { min: 1150, max: 1449 };
    case "Ouro":
      return { min: 1450, max: 1799 };
    case "Diamante":
      return { min: 1800, max: 2199 };
    case "Elite":
      return { min: 2200, max: 2600 };
    default:
      return { min: 0, max: 1149 };
  }
}

export function getTierProgress(rating = 1000, tier = "Bronze") {
  const { min, max } = getTierBounds(tier);

  if (tier === "Elite") return 100;
  if (rating <= min) return 0;
  if (rating >= max) return 100;

  return Math.round(((rating - min) / (max - min)) * 100);
}

function normalizeMatchResult(result) {
  const value = String(result || "").trim().toUpperCase();
  if (value === "WIN" || value === "LOSS" || value === "DRAW") {
    return value;
  }
  return "LOSS";
}

function calcRatingDelta({
  result = "LOSS",
  goals = 0,
  assists = 0,
  isMvp = false,
}) {
  const safeResult = normalizeMatchResult(result);

  let delta = 0;

  if (safeResult === "WIN") {
    delta += 25;
  } else if (safeResult === "DRAW") {
    delta += 5;
  } else {
    delta -= 15;
  }

  delta += Number(goals || 0) * 2;
  delta += Number(assists || 0) * 3;

  if (isMvp) {
    delta += 8;
  }

  return delta;
}

export async function ensurePlayerRank(userId) {
  if (!userId) {
    throw new Error("userId é obrigatório em ensurePlayerRank.");
  }

  let rank = await prisma.playerRank.findUnique({
    where: { userId },
  });

  if (!rank) {
    rank = await prisma.playerRank.create({
      data: {
        userId,
        rating: 1000,
        wins: 0,
        losses: 0,
        draws: 0,
        matches: 0,
        goals: 0,
        assists: 0,
        mvpCount: 0,
        winStreak: 0,
        bestWinStreak: 0,
        tier: "Bronze",
        progress: 0,
        rankPosition: 0,
        season: "global",
      },
    });
  }

  return rank;
}

export async function updatePlayerRankAfterMatch({
  userId,
  result,
  goals = 0,
  assists = 0,
  isMvp = false,
}) {
  if (!userId) {
    throw new Error("userId é obrigatório em updatePlayerRankAfterMatch.");
  }

  const safeResult = normalizeMatchResult(result);

  const current = await ensurePlayerRank(userId);

  const delta = calcRatingDelta({
    result: safeResult,
    goals,
    assists,
    isMvp,
  });

  const newRating = Math.max(0, Number(current.rating || 0) + delta);
  const newTier = getTierFromRating(newRating);
  const newProgress = getTierProgress(newRating, newTier);

  const newMatches = Number(current.matches || 0) + 1;
  const newWins = Number(current.wins || 0) + (safeResult === "WIN" ? 1 : 0);
  const newLosses =
    Number(current.losses || 0) + (safeResult === "LOSS" ? 1 : 0);
  const newDraws =
    Number(current.draws || 0) + (safeResult === "DRAW" ? 1 : 0);

  const newWinStreak =
    safeResult === "WIN" ? Number(current.winStreak || 0) + 1 : 0;

  const bestWinStreak = Math.max(
    Number(current.bestWinStreak || 0),
    newWinStreak
  );

  return prisma.playerRank.update({
    where: { userId },
    data: {
      rating: newRating,
      tier: newTier,
      progress: newProgress,
      matches: newMatches,
      wins: newWins,
      losses: newLosses,
      draws: newDraws,
      goals: Number(current.goals || 0) + Number(goals || 0),
      assists: Number(current.assists || 0) + Number(assists || 0),
      mvpCount: Number(current.mvpCount || 0) + (isMvp ? 1 : 0),
      winStreak: newWinStreak,
      bestWinStreak,
    },
  });
}

export async function refreshGlobalRankPositions() {
  const players = await prisma.playerRank.findMany({
    orderBy: [
      { rating: "desc" },
      { wins: "desc" },
      { goals: "desc" },
      { updatedAt: "asc" },
    ],
    select: {
      id: true,
    },
  });

  if (!players.length) return;

  await prisma.$transaction(
    players.map((player, index) =>
      prisma.playerRank.update({
        where: { id: player.id },
        data: {
          rankPosition: index + 1,
        },
      })
    )
  );
}

export function buildRankSummary(rank) {
  const tier = rank?.tier || "Bronze";

  return {
    tier,
    rating: Number(rank?.rating || 1000),
    rankPosition: Number(rank?.rankPosition || 0),
    nextTier: getNextTier(tier),
    progress: Number(rank?.progress || 0),
    wins: Number(rank?.wins || 0),
    losses: Number(rank?.losses || 0),
    draws: Number(rank?.draws || 0),
    matches: Number(rank?.matches || 0),
    goals: Number(rank?.goals || 0),
    assists: Number(rank?.assists || 0),
    mvpCount: Number(rank?.mvpCount || 0),
    winStreak: Number(rank?.winStreak || 0),
    bestWinStreak: Number(rank?.bestWinStreak || 0),
    winRate:
      Number(rank?.matches || 0) > 0
        ? Math.round(
            (Number(rank?.wins || 0) / Number(rank?.matches || 0)) * 100
          )
        : 0,
  };
}

/**
 * Processa o rank da partida finalizada.
 * Regras:
 * - só processa se status = FINISHED
 * - não processa duas vezes
 * - usa stats oficiais da partida
 */
export async function processMatchRank(matchId) {
  if (!matchId) {
    throw new Error("matchId é obrigatório em processMatchRank.");
  }

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      presences: true,
      stats: true,
    },
  });

  if (!match) {
    throw new Error("Partida não encontrada.");
  }

  if (match.rankProcessed) {
    return {
      ok: true,
      skipped: true,
      reason: "Rank já processado para esta partida.",
    };
  }

  if (match.status !== "FINISHED") {
    throw new Error("A partida precisa estar finalizada antes de processar rank.");
  }

  const players = Array.isArray(match.presences)
    ? match.presences.filter((presence) => presence?.userId)
    : [];

  if (!players.length) {
    throw new Error("A partida não possui jogadores confirmados.");
  }

  const isDraw = match.teamAScore === match.teamBScore || !match.winnerSide;

  for (const presence of players) {
    const stat = Array.isArray(match.stats)
      ? match.stats.find((item) => item.userId === presence.userId)
      : null;

    let result = "LOSS";

    if (isDraw) {
      result = "DRAW";
    } else if (presence.teamSide && presence.teamSide === match.winnerSide) {
      result = "WIN";
    } else {
      result = "LOSS";
    }

    await updatePlayerRankAfterMatch({
      userId: presence.userId,
      result,
      goals: Number(stat?.goalsOfficial || 0),
      assists: Number(stat?.assistsOfficial || 0),
      isMvp: false,
    });
  }

  await refreshGlobalRankPositions();

  await prisma.match.update({
    where: { id: matchId },
    data: {
      rankProcessed: true,
    },
  });

  return {
    ok: true,
    skipped: false,
  };
}

export async function getGlobalRanking({ take = 100 } = {}) {
  const ranking = await prisma.playerRank.findMany({
    orderBy: [
      { rating: "desc" },
      { wins: "desc" },
      { goals: "desc" },
    ],
    take,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
        },
      },
    },
  });

  return ranking.map((item) => ({
    userId: item.userId,
    name: item.user?.name || "Jogador",
    avatar: item.user?.imageUrl || "",
    tier: item.tier,
    rating: item.rating,
    rankPosition: item.rankPosition,
    wins: item.wins,
    losses: item.losses,
    draws: item.draws,
    matches: item.matches,
    goals: item.goals,
    assists: item.assists,
    mvpCount: item.mvpCount,
    progress: item.progress,
    nextTier: getNextTier(item.tier),
  }));
}