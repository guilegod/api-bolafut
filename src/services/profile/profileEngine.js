import { prisma } from "../../lib/prisma.js";

function getTier(rating) {
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
  return Math.max(0, Math.min(100, value));
}

function buildAchievements(stats, history) {
  const matches = stats.matches || 0;
  const goals = stats.goals || 0;
  const assists = stats.assists || 0;
  const wins = stats.wins || 0;

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

function buildRank(stats) {
  const rating =
    (stats.wins || 0) * 12 +
    (stats.goals || 0) * 3 +
    (stats.assists || 0) * 2;

  const tier = getTier(rating);

  return {
    tier,
    rating,
    rankPosition: 0,
    nextTier: getNextTier(tier),
    progress: clampProgress(rating % 100),
    wins: stats.wins || 0,
    matches: stats.matches || 0,
  };
}

export async function getUserProfileDashboardById(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
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
        },
      },
    },
  });

  const stats = statRows.reduce(
    (acc, row) => {
      acc.matches += 1;
      acc.wins += row.wins || 0;
      acc.goals += (row.goalsOfficial || 0) + (row.goalsUnofficial || 0);
      acc.assists += (row.assistsOfficial || 0) + (row.assistsUnofficial || 0);
      return acc;
    },
    {
      matches: 0,
      wins: 0,
      goals: 0,
      assists: 0,
    }
  );

  const history = matchesPlayed.map((match) => {
    const presence = match.presences.find((p) => p.userId === userId);

    let result = null;
    if (match.winnerSide && presence?.teamSide) {
      result = presence.teamSide === match.winnerSide ? "win" : "loss";
    }

    return {
      id: match.id,
      type: String(match.kind || "PELADA").toLowerCase(),
      title: match.title,
      arena: match.court?.arena?.name || "Arena",
      date: match.date,
      result,
      score: `${match.teamAScore} x ${match.teamBScore}`,
    };
  });

  const rank = buildRank(stats);
  const achievements = buildAchievements(stats, history);

  return {
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      avatarUrl: user.imageUrl || "",
      role: user.role,
      createdAt: user.createdAt,
      city: user.profile?.city || "Curitiba - PR",
      bio: user.profile?.bio || "",
      position: user.profile?.position || "MEI",
      foot: user.profile?.foot || "Destro",
      username: user.profile?.username || null,
      level: user.profile?.level || null,
      bairro: user.profile?.bairro || "",
      coverImageUrl: user.profile?.coverImageUrl || "",
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
        avatar: item.user?.imageUrl || "",
      },
      meta: item.meta || {},
    })),
  };
}