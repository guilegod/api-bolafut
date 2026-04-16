import { Router } from "express";
import { z } from "zod";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import { createFeedPost } from "../services/profile/feedService.js";
import { processMatchRank } from "../services/rankService.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const router = Router();

// 🔎 Rota de verificação de versão
router.get("/__version", (req, res) => {
  res.json({
    ok: true,
    version: "matches_routes_v17_pelada_location",
  });
});

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

/* ======================================================
   INCLUDES
   ====================================================== */

const includePremium = {
  court: {
    include: {
      arena: true,
    },
  },
  peladaLocation: true,
  presences: {
    select: {
      id: true,
      userId: true,
      status: true,
      teamSide: true,
      isCaptain: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          imageUrl: true,
        },
      },
    },
  },
  organizer: {
    select: { id: true, name: true, email: true, role: true, imageUrl: true },
  },
  controller: {
    select: { id: true, name: true, email: true, role: true, imageUrl: true },
  },
  events: {
    orderBy: { createdAt: "asc" },
    include: {
      player: { select: { id: true, name: true, imageUrl: true } },
      assistPlayer: { select: { id: true, name: true, imageUrl: true } },
      createdBy: { select: { id: true, name: true, role: true } },
    },
  },
};

const includePublic = {
  court: {
    include: {
      arena: true,
    },
  },
  peladaLocation: true,
  presences: {
    select: {
      id: true,
      userId: true,
      status: true,
      teamSide: true,
      isCaptain: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, role: true, imageUrl: true },
      },
    },
  },
  organizer: { select: { id: true, name: true, role: true, imageUrl: true } },
  controller: { select: { id: true, name: true, role: true, imageUrl: true } },
  events: {
    orderBy: { createdAt: "asc" },
    include: {
      player: { select: { id: true, name: true, imageUrl: true } },
      assistPlayer: { select: { id: true, name: true, imageUrl: true } },
      createdBy: { select: { id: true, name: true, role: true } },
    },
  },
};

/* ======================================================
   SCHEMAS
   ====================================================== */

const matchCreateSchema = z.object({
  title: z.string().min(2),
  date: z.string().min(5),

  type: z
    .enum([
      "FUTSAL",
      "FUT7",
      "CAMPO",
      "VOLEI",
      "FUTVOLEI",
      "BEACH_TENNIS",
      "BASQUETE",
      "TENIS",
      "HANDEBOL",
      "SKATE",
      "OUTRO",
    ])
    .default("FUT7"),

  // 👇 NOVO
  isPrivate: z.coerce.boolean().optional(),
  accessPassword: z.string().min(3).max(20).optional(),

  courtId: z.string().min(3).optional().nullable(),
  peladaLocationId: z.string().min(3).optional().nullable(),
  manualArenaName: z.string().min(2).max(120).optional().nullable(),
  manualAddress: z.string().min(2).max(180).optional().nullable(),

  maxPlayers: z.coerce.number().int().min(2).max(40).optional(),
  pricePerPlayer: z.coerce.number().int().min(0).max(9999).optional(),
  minPlayers: z.coerce.number().int().min(0).max(40).optional(),

  controllerId: z.string().min(3).optional().nullable(),
  teamAName: z.string().min(1).max(60).optional().nullable(),
  teamBName: z.string().min(1).max(60).optional().nullable(),
});

const statEventSchema = z.object({
  userId: z.string().min(5),
  type: z.enum(["goal", "assist"]),
  mode: z.enum(["official", "unofficial"]),
  delta: z.number().int().min(-1).max(1),
});

const goalEventSchema = z.object({
  playerId: z.string().min(3),
  assistPlayerId: z.string().min(3).optional().nullable(),
  teamSide: z.enum(["A", "B"]),
  minute: z.coerce.number().int().min(0).max(200).optional().nullable(),
  notes: z.string().max(300).optional().nullable(),
});

const assignControllerSchema = z.object({
  controllerId: z.string().min(3).nullable(),
});

const assignTeamSideSchema = z.object({
  userId: z.string().min(3),
  teamSide: z.enum(["A", "B"]).nullable(),
  isCaptain: z.boolean().optional(),
});

/* ======================================================
   HELPERS
   ====================================================== */

function addMinutes(date, minutes) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function getArenaLabel(match) {
  return (
    match?.court?.arena?.name ||
    match?.peladaLocation?.name ||
    match?.manualArenaName ||
    ""
  );
}

function parseBrazilDateTimeToUTC(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const hasTimezone =
    raw.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(raw);

  if (hasTimezone) {
    const parsed = dayjs(raw);
    return parsed.isValid() ? parsed.toDate() : null;
  }

  const normalized = raw.replace(" ", "T");
  const parsed = dayjs.tz(normalized, "America/Sao_Paulo");

  if (!parsed.isValid()) return null;

  return parsed.utc().toDate();
}

function parseBrazilDate(value) {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const parsed = dayjs.tz(raw, "America/Sao_Paulo");
  if (!parsed.isValid()) return null;

  return parsed;
}

async function canEditOfficialStats(user, matchId) {
  if (user?.role === "admin") return true;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      organizerId: true,
      controllerId: true,
      court: {
        select: {
          arenaOwnerId: true,
          arena: { select: { ownerId: true } },
        },
      },
    },
  });

  if (!match) return false;

  if (match.controllerId && match.controllerId === user.id) return true;

  if (user?.role === "owner" && match.organizerId === user.id) return true;

  if (user?.role === "arena_owner") {
    const legacyOk = match.court?.arenaOwnerId === user.id;
    const newOk = match.court?.arena?.ownerId === user.id;
    return Boolean(legacyOk || newOk);
  }

  return false;
}

async function canManageMatch(user, matchId) {
  if (user?.role === "admin") return true;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      organizerId: true,
      controllerId: true,
      court: {
        select: {
          arenaOwnerId: true,
          arena: { select: { ownerId: true } },
        },
      },
      presences: {
        where: { userId: user?.id },
        select: { id: true, isCaptain: true },
        take: 1,
      },
    },
  });

  if (!match) return false;

  if (match.controllerId && match.controllerId === user.id) return true;
  if (user?.role === "owner" && match.organizerId === user.id) return true;

  if (user?.role === "arena_owner") {
    const legacyOk = match.court?.arenaOwnerId === user.id;
    const newOk = match.court?.arena?.ownerId === user.id;
    if (legacyOk || newOk) return true;
  }

  const presence = match.presences?.[0];
  if (presence?.isCaptain) return true;

  return false;
}

async function isUserInMatch(userId, matchId) {
  const presence = await prisma.matchPresence.findFirst({
    where: { matchId, userId },
    select: { id: true },
  });
  return Boolean(presence);
}

async function getControllerLockedMatch(matchId) {
  return prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      controllerId: true,
      teamAScore: true,
      teamBScore: true,
      teamAName: true,
      teamBName: true,
      title: true,
      manualArenaName: true,
      manualAddress: true,
      isManualLocation: true,
      peladaLocation: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
      court: {
        select: {
          arena: {
            select: {
              name: true,
            },
          },
        },
      },
      presences: {
        select: {
          userId: true,
          teamSide: true,
          isCaptain: true,
        },
      },
    },
  });
}

async function recalcMatchScore(matchId) {
  const grouped = await prisma.matchEvent.groupBy({
    by: ["teamSide"],
    where: {
      matchId,
      type: "GOAL",
      status: "CONFIRMED",
    },
    _count: { _all: true },
  });

  let teamAScore = 0;
  let teamBScore = 0;

  for (const row of grouped) {
    if (row.teamSide === "A") teamAScore = row._count._all;
    if (row.teamSide === "B") teamBScore = row._count._all;
  }

  let winnerSide = null;
  if (teamAScore > teamBScore) winnerSide = "A";
  if (teamBScore > teamAScore) winnerSide = "B";

  await prisma.match.update({
    where: { id: matchId },
    data: {
      teamAScore,
      teamBScore,
      winnerSide,
    },
  });

  return { teamAScore, teamBScore, winnerSide };
}

async function maybeAutoExpireMatch(matchId, opts = {}) {
  const {
    returnUpdatedOnly = false,
    currentMatch = null,
    include = includePremium,
  } = opts;

  const base =
    currentMatch && currentMatch.id === matchId
      ? {
          id: currentMatch.id,
          status: currentMatch.status,
          date: currentMatch.date,
          minPlayers: currentMatch.minPlayers,
          presences: currentMatch.presences,
        }
      : await prisma.match.findUnique({
          where: { id: matchId },
          select: {
            id: true,
            status: true,
            date: true,
            minPlayers: true,
            presences: { select: { id: true } },
          },
        });

  if (!base) return null;

  const status = base.status || "SCHEDULED";
  if (status !== "SCHEDULED") {
    if (returnUpdatedOnly) return null;
    return currentMatch
      ? currentMatch
      : await prisma.match.findUnique({ where: { id: matchId }, include });
  }

  const minPlayers = Number(base.minPlayers || 0);
  if (minPlayers <= 0) {
    if (returnUpdatedOnly) return null;
    return currentMatch
      ? currentMatch
      : await prisma.match.findUnique({ where: { id: matchId }, include });
  }

  const now = new Date();
  const deadline = addMinutes(new Date(base.date), 30);

  if (now <= deadline) {
    if (returnUpdatedOnly) return null;
    return currentMatch
      ? currentMatch
      : await prisma.match.findUnique({ where: { id: matchId }, include });
  }

  const joined = base.presences?.length || 0;
  if (joined >= minPlayers) {
    if (returnUpdatedOnly) return null;
    return currentMatch
      ? currentMatch
      : await prisma.match.findUnique({ where: { id: matchId }, include });
  }

  const updated = await prisma.match.update({
    where: { id: matchId },
    data: {
      status: "EXPIRED",
      canceledAt: new Date(),
    },
    include,
  });

  return updated;
}

async function rebuildOfficialStatsFromEvents(matchId) {
  const events = await prisma.matchEvent.findMany({
    where: {
      matchId,
      status: "CONFIRMED",
      type: "GOAL",
    },
    select: {
      playerId: true,
      assistPlayerId: true,
    },
  });

  const presences = await prisma.matchPresence.findMany({
    where: { matchId },
    select: { userId: true },
  });

  const userIds = [...new Set(presences.map((p) => p.userId))];

  for (const userId of userIds) {
    await prisma.matchPlayerStat.upsert({
      where: {
        matchId_userId: { matchId, userId },
      },
      create: {
        matchId,
        userId,
        goalsOfficial: 0,
        assistsOfficial: 0,
        goalsUnofficial: 0,
        assistsUnofficial: 0,
        wins: 0,
      },
      update: {
        goalsOfficial: 0,
        assistsOfficial: 0,
      },
    });
  }

  const goalsMap = new Map();
  const assistsMap = new Map();

  for (const event of events) {
    if (event.playerId) {
      goalsMap.set(event.playerId, (goalsMap.get(event.playerId) || 0) + 1);
    }
    if (event.assistPlayerId) {
      assistsMap.set(
        event.assistPlayerId,
        (assistsMap.get(event.assistPlayerId) || 0) + 1
      );
    }
  }

  for (const userId of userIds) {
    const goalsOfficial = goalsMap.get(userId) || 0;
    const assistsOfficial = assistsMap.get(userId) || 0;

    await prisma.matchPlayerStat.update({
      where: {
        matchId_userId: { matchId, userId },
      },
      data: {
        goalsOfficial,
        assistsOfficial,
      },
    });
  }
}

async function ensureOnlyControllerOrAdmin(user, match) {
  if (!match) return false;
  if (user?.role === "admin") return true;
  if (!match.controllerId) return false;
  return match.controllerId === user.id;
}

async function countConfirmedGoals(matchId) {
  return prisma.matchEvent.count({
    where: {
      matchId,
      type: "GOAL",
      status: "CONFIRMED",
    },
  });
}

/* ======================================================
   ✅ PELADAS (públicas)
   ====================================================== */

router.get("/peladas", async (req, res) => {
  try {
    const arenaId = req.query.arenaId ? String(req.query.arenaId) : null;
    const arenaSlug = req.query.slug ? String(req.query.slug) : null;
    const courtId = req.query.courtId ? String(req.query.courtId) : null;

    const dateStr = req.query.date ? String(req.query.date) : null;
    const fromStr = req.query.from ? String(req.query.from) : null;
    const toStr = req.query.to ? String(req.query.to) : null;

    let from = null;
    let to = null;

    if (fromStr) {
      const parsedFrom = parseBrazilDate(fromStr);
      from = parsedFrom ? parsedFrom.startOf("day").utc().toDate() : null;
    }

    if (toStr) {
      const parsedTo = parseBrazilDate(toStr);
      to = parsedTo ? parsedTo.endOf("day").utc().toDate() : null;
    }

    if (!from && !to && dateStr) {
      const parsedDate = parseBrazilDate(dateStr);
      if (parsedDate) {
        from = parsedDate.startOf("day").utc().toDate();
        to = parsedDate.endOf("day").utc().toDate();
      }
    }

    const where = {
      kind: "PELADA",
      ...(courtId ? { courtId } : {}),
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(arenaId || arenaSlug
        ? {
            court: {
              arena: {
                ...(arenaId ? { id: arenaId } : {}),
                ...(arenaSlug ? { slug: arenaSlug } : {}),
              },
            },
          }
        : {}),
    };

    const peladas = await prisma.match.findMany({
      where,
      orderBy: { date: "asc" },
      include: includePublic,
      take: 200,
    });

    const updated = [];
    for (const m of peladas) {
      const maybe = await maybeAutoExpireMatch(m.id, {
        returnUpdatedOnly: false,
        currentMatch: m,
        include: includePublic,
      });

      const safeMatch = { ...(maybe || m) };
      delete safeMatch.accessPassword;

      updated.push(safeMatch);
    }

    return res.json(updated);
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Erro ao listar peladas", error: String(e) });
  }
});
/* ======================================================
   🔓 DETALHE PÚBLICO (SEM LOGIN)
   ====================================================== */

router.get("/public/:id([a-z0-9]{20,})", async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();

    const match = await maybeAutoExpireMatch(matchId, {
      returnUpdatedOnly: false,
      currentMatch: null,
      include: includePublic,
    });

    if (!match) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    if (match.kind !== "PELADA") {
      return res.status(403).json({
        message: "Esta partida não está disponível publicamente",
      });
    }

    if (match.isPrivate) {
      const password = String(
        req.body?.password ||
          req.query?.password ||
          req.headers["x-match-password"] ||
          ""
      ).trim();

      if (!password) {
        return res.status(401).json({
          message: "Senha obrigatória para acessar esta partida.",
        });
      }

      if (password !== String(match.accessPassword || "").trim()) {
        return res.status(401).json({
          message: "Senha inválida.",
        });
      }
    }

    const safeMatch = { ...match };
    delete safeMatch.accessPassword;

    return res.json(safeMatch);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao buscar partida pública",
      error: String(e),
    });
  }
});

router.post("/peladas", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["admin", "owner", "arena_owner"])) {
      return res.status(403).json({
        message: "Sem permissão para criar peladas",
      });
    }

    const data = matchCreateSchema.parse({ ...req.body, kind: "PELADA" });

    // 🔒 validação obrigatória de senha
    if (data.isPrivate && !data.accessPassword) {
      return res.status(400).json({
        message: "Partida privada precisa de senha",
      });
    }

    const matchStart = parseBrazilDateTimeToUTC(data.date);
    if (!matchStart || Number.isNaN(matchStart.getTime())) {
      return res
        .status(400)
        .json({ message: "Dados inválidos", error: "date inválido." });
    }

    const matchEnd = addMinutes(matchStart, 60);

    const courtIdStr = String(data.courtId || "").trim();
    const peladaLocationIdStr = String(data.peladaLocationId || "").trim();
    const manualArenaName = String(data.manualArenaName || "").trim();
    const manualAddress = String(data.manualAddress || "").trim();

    const hasCourt = Boolean(courtIdStr);
    const hasPeladaLocation = Boolean(peladaLocationIdStr);
    const isManualLocation = !hasCourt && !hasPeladaLocation;

    if (hasCourt && hasPeladaLocation) {
      return res.status(400).json({
        message: "Dados inválidos",
        error: "Use apenas courtId OU peladaLocationId.",
      });
    }

    if (hasPeladaLocation && (manualArenaName || manualAddress)) {
      return res.status(400).json({
        message: "Dados inválidos",
        error: "Não envie manualArenaName/manualAddress junto com peladaLocationId.",
      });
    }

    /* ======================================================
       🔥 LOCAL CADASTRADO
       ====================================================== */
    if (hasPeladaLocation) {
      const peladaLocation = await prisma.peladaLocation.findUnique({
        where: { id: peladaLocationIdStr },
      });

      if (!peladaLocation || !peladaLocation.isActive) {
        return res.status(400).json({
          message: "Dados inválidos",
          error: "Local cadastrado não encontrado ou inativo.",
        });
      }

    const match = await prisma.match.create({
      data: {
        title: data.title,
        date: matchStart,
        type: data.type,
        organizerId: user.id,
        controllerId: data.controllerId || user.id,
        courtId: null,
        peladaLocationId: peladaLocation.id,
        manualArenaName: null,
        manualAddress: null,
        isManualLocation: false,

        isPrivate: data.isPrivate ?? false,
        accessPassword: data.isPrivate
          ? String(data.accessPassword || "").trim()
          : null,

        teamAName: data.teamAName || "Time A",
        teamBName: data.teamBName || "Time B",
        teamAScore: 0,
        teamBScore: 0,
        maxPlayers: data.maxPlayers ?? 14,
        minPlayers: data.minPlayers ?? 0,
        pricePerPlayer: data.pricePerPlayer ?? 30,
        status: "SCHEDULED",
        kind: "PELADA",
      },
      include: includePremium,
    });

      await prisma.matchPresence.create({
        data: {
          matchId: match.id,
          userId: user.id,
          teamSide: "A",
          isCaptain: true,
        },
      });

      const updated = await prisma.match.findUnique({
        where: { id: match.id },
        include: includePremium,
      });

      return res.status(201).json(updated || match);
    }

    /* ======================================================
       🔥 MANUAL
       ====================================================== */
    if (isManualLocation) {
      if (user.role === "owner") {
        return res.status(403).json({
          message: "Owner só pode criar peladas em locais cadastrados",
        });
      }

      if (!manualArenaName || !manualAddress) {
        return res.status(400).json({
          message: "Dados inválidos",
          error:
            "Para pelada manual, informe manualArenaName e manualAddress.",
        });
      }

      const match = await prisma.match.create({
        data: {
          title: data.title,
          date: matchStart,
          type: data.type,
          organizerId: user.id,
          controllerId: data.controllerId || user.id,
          courtId: null,
          peladaLocationId: null,
          manualArenaName,
          manualAddress,
          isManualLocation: true,

          // 🔥 ADICIONA AQUI
          isPrivate: data.isPrivate ?? false,
          accessPassword: data.isPrivate
            ? String(data.accessPassword || "").trim()
            : null,

          teamAName: data.teamAName || "Time A",
          teamBName: data.teamBName || "Time B",
          teamAScore: 0,
          teamBScore: 0,
          maxPlayers: data.maxPlayers ?? 14,
          minPlayers: data.minPlayers ?? 0,
          pricePerPlayer: data.pricePerPlayer ?? 30,
          status: "SCHEDULED",
          kind: "PELADA",
        },
        include: includePremium,
      });

      await prisma.matchPresence.create({
        data: {
          matchId: match.id,
          userId: user.id,
          teamSide: "A",
          isCaptain: true,
        },
      });

      const updated = await prisma.match.findUnique({
        where: { id: match.id },
        include: includePremium,
      });

      return res.status(201).json(updated || match);
    }

    /* ======================================================
       🔥 QUADRA (mantido com validações originais)
       ====================================================== */

    const court = await prisma.court.findUnique({
      where: { id: courtIdStr },
      include: { arena: true },
    });

    if (!court) {
      return res
        .status(400)
        .json({ message: "Dados inválidos", error: "courtId não existe." });
    }

    if (isRole(user, ["arena_owner"])) {
      const legacyOk = court.arenaOwnerId === user.id;
      const newOk = court.arena?.ownerId === user.id;

      if (!legacyOk && !newOk) {
        return res.status(403).json({
          message: "Você só pode criar peladas nas suas próprias quadras",
        });
      }
    }

    const conflictReservation = await prisma.reservation.findFirst({
      where: {
        courtId: courtIdStr,
        status: { not: "CANCELED" },
        startAt: { lt: matchEnd },
        endAt: { gt: matchStart },
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        paymentStatus: true,
      },
    });

    if (conflictReservation) {
      return res.status(409).json({
        message: "Horário já reservado (Reservation)",
        conflict: { type: "reservation", ...conflictReservation },
      });
    }

    const windowStart = addMinutes(matchStart, -180);
    const windowEnd = addMinutes(matchEnd, 180);

    const nearMatches = await prisma.match.findMany({
      where: {
        courtId: courtIdStr,
        date: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, date: true, title: true },
    });

    const conflictMatch = nearMatches.find((m) => {
      const mStart = new Date(m.date);
      const mEnd = addMinutes(mStart, 60);
      return overlaps(matchStart, matchEnd, mStart, mEnd);
    });

    if (conflictMatch) {
      return res.status(409).json({
        message: "Horário já ocupado por outra partida (Match)",
        conflict: {
          type: "match",
          id: conflictMatch.id,
          date: conflictMatch.date,
          title: conflictMatch.title,
        },
      });
    }

    const match = await prisma.match.create({
        data: {
          title: data.title,
          date: matchStart,
          type: data.type,
          organizerId: user.id,
          controllerId: data.controllerId || user.id,
          courtId: courtIdStr,
          peladaLocationId: null,
          manualArenaName: null,
          manualAddress: null,
          isManualLocation: false,

          isPrivate: data.isPrivate ?? false,
          accessPassword: data.isPrivate
            ? String(data.accessPassword || "").trim()
            : null,

          teamAName: data.teamAName || "Time A",
          teamBName: data.teamBName || "Time B",
          teamAScore: 0,
          teamBScore: 0,
          maxPlayers: data.maxPlayers ?? 14,
          minPlayers: data.minPlayers ?? 0,
          pricePerPlayer: data.pricePerPlayer ?? 30,
          status: "SCHEDULED",
          kind: "PELADA",
        },
        include: includePremium,
      });

    await prisma.matchPresence.create({
      data: {
        matchId: match.id,
        userId: user.id,
        teamSide: "A",
        isCaptain: true,
      },
    });

    const updated = await prisma.match.findUnique({
      where: { id: match.id },
      include: includePremium,
    });

    return res.status(201).json(updated || match);
  } catch (e) {
    return res
      .status(400)
      .json({ message: "Dados inválidos", error: String(e) });
  }
});

/* ======================================================
   GET /matches
   ====================================================== */

router.get("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    let where = undefined;

    if (isRole(user, ["admin"])) {
      where = undefined;
    } else if (isRole(user, ["arena_owner"])) {
      where = {
        court: {
          OR: [{ arenaOwnerId: user.id }, { arena: { ownerId: user.id } }],
        },
      };
    } else if (isRole(user, ["owner"])) {
      where = { organizerId: user.id };
    } else {
      where = { presences: { some: { userId: user.id } } };
    }

    const matches = await prisma.match.findMany({
      where,
      orderBy: { date: "asc" },
      include: includePremium,
    });

    const updatedMatches = [];
    for (const m of matches) {
      if (m?.id) {
        const maybe = await maybeAutoExpireMatch(m.id, {
          returnUpdatedOnly: false,
          currentMatch: m,
          include: includePremium,
        });
        updatedMatches.push(maybe || m);
      } else {
        updatedMatches.push(m);
      }
    }

    return res.json(updatedMatches);
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Erro ao listar partidas", error: String(e) });
  }
});

/* ======================================================
   GET /matches/:id
   ====================================================== */

router.get("/:id([a-z0-9]{20,})", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();

    const match = await maybeAutoExpireMatch(matchId, {
      returnUpdatedOnly: false,
      currentMatch: null,
      include: includePremium,
    });

    if (!match) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    return res.json(match);
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Erro ao buscar partida", error: String(e) });
  }
});

/* ======================================================
   POST /matches
   ====================================================== */

router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["owner", "arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = matchCreateSchema.parse(req.body);
    const courtIdStr = String(data.courtId || "").trim();

    const matchStart = parseBrazilDateTimeToUTC(data.date);
    if (!matchStart || Number.isNaN(matchStart.getTime())) {
      return res
        .status(400)
        .json({ message: "Dados inválidos", error: "date inválido." });
    }

    const matchEnd = addMinutes(matchStart, 60);

    const court = await prisma.court.findUnique({
      where: { id: courtIdStr },
      include: { arena: true },
    });

    if (!court) {
      return res
        .status(400)
        .json({ message: "Dados inválidos", error: "courtId não existe." });
    }

    if (isRole(user, ["arena_owner"])) {
      const legacyOk = court.arenaOwnerId === user.id;
      const newOk = court.arena?.ownerId === user.id;
      if (!legacyOk && !newOk) {
        return res.status(403).json({
          message: "Você só pode criar partidas nas suas próprias quadras",
        });
      }
    }

    const conflictReservation = await prisma.reservation.findFirst({
      where: {
        courtId: courtIdStr,
        status: { not: "CANCELED" },
        startAt: { lt: matchEnd },
        endAt: { gt: matchStart },
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        paymentStatus: true,
      },
    });

    if (conflictReservation) {
      return res.status(409).json({
        message: "Horário já reservado (Reservation)",
        conflict: { type: "reservation", ...conflictReservation },
      });
    }

    const windowStart = addMinutes(matchStart, -180);
    const windowEnd = addMinutes(matchEnd, 180);

    const nearMatches = await prisma.match.findMany({
      where: {
        courtId: courtIdStr,
        date: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, date: true, title: true },
    });

    const conflictMatch = nearMatches.find((m) => {
      const mStart = new Date(m.date);
      const mEnd = addMinutes(mStart, 60);
      return overlaps(matchStart, matchEnd, mStart, mEnd);
    });

    if (conflictMatch) {
      return res.status(409).json({
        message: "Horário já ocupado por outra partida (Match)",
        conflict: {
          type: "match",
          id: conflictMatch.id,
          date: conflictMatch.date,
          title: conflictMatch.title,
        },
      });
    }

    const match = await prisma.match.create({
      data: {
        title: data.title,
        date: matchStart,
        type: data.type,
        organizerId: user.id,
        controllerId: data.controllerId || user.id,
        courtId: courtIdStr,
        manualArenaName: null,
        manualAddress: null,
        isManualLocation: false,

        // 🔥 AQUI
        isPrivate: data.isPrivate ?? false,
        accessPassword:
          data.isPrivate && data.accessPassword
            ? String(data.accessPassword).trim()
            : null,

        teamAName: data.teamAName || "Time A",
        teamBName: data.teamBName || "Time B",
        teamAScore: 0,
        teamBScore: 0,
        maxPlayers: data.maxPlayers ?? 14,
        minPlayers: data.minPlayers ?? 0,
        pricePerPlayer: data.pricePerPlayer ?? 30,
        status: "SCHEDULED",
        kind: data.kind || "BOOKING",
      },
      include: includePremium,
    });

    return res.status(201).json(match);
  } catch (e) {
    return res
      .status(400)
      .json({ message: "Dados inválidos", error: String(e) });
  }
});

/* ======================================================
   MATCH STATUS
   ====================================================== */

router.patch("/:id([a-z0-9]{20,})/start", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const ok = await canManageMatch(user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão" });

    const match = await prisma.match.update({
      where: { id: matchId },
      data: { status: "LIVE", startedAt: new Date() },
      include: includePremium,
    });

    return res.json(match);
  } catch (e) {
    return res
      .status(400)
      .json({ message: "Erro ao iniciar partida", error: String(e) });
  }
});

router.patch("/:id([a-z0-9]{20,})/finish", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const matchLocked = await getControllerLockedMatch(matchId);
    if (!matchLocked) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    const isAllowed = await ensureOnlyControllerOrAdmin(user, matchLocked);
    if (!isAllowed) {
      return res.status(403).json({
        message: "Apenas o controlador pode finalizar a partida",
      });
    }

    await recalcMatchScore(matchId);
    await rebuildOfficialStatsFromEvents(matchId);

    const matchBefore = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        title: true,
        manualArenaName: true,
        manualAddress: true,
        isManualLocation: true,
        peladaLocation: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
        teamAName: true,
        teamBName: true,
        teamAScore: true,
        teamBScore: true,
        winnerSide: true,
        court: {
          select: {
            arena: {
              select: {
                name: true,
              },
            },
          },
        },
        presences: {
          select: { userId: true, teamSide: true },
        },
      },
    });

    const isDraw = matchBefore?.teamAScore === matchBefore?.teamBScore;

    const winnerSide =
      matchBefore?.teamAScore > matchBefore?.teamBScore
        ? "A"
        : matchBefore?.teamBScore > matchBefore?.teamAScore
        ? "B"
        : null;

    const participants = matchBefore?.presences || [];
    const userIds = [...new Set(participants.map((p) => p.userId))];

    for (const userId of userIds) {
      const participant = participants.find((p) => p.userId === userId);
      const didWin = !isDraw && winnerSide && participant?.teamSide === winnerSide;

      await prisma.matchPlayerStat
        .upsert({
          where: { matchId_userId: { matchId, userId } },
          create: {
            matchId,
            userId,
            goalsOfficial: 0,
            assistsOfficial: 0,
            goalsUnofficial: 0,
            assistsUnofficial: 0,
            wins: didWin ? 1 : 0,
          },
          update: didWin
            ? {
                wins: { increment: 1 },
              }
            : {},
        })
        .catch(() => null);
    }

    const match = await prisma.match.update({
      where: { id: matchId },
      data: {
        status: "FINISHED",
        finishedAt: new Date(),
        winnerSide: isDraw ? null : winnerSide,
      },
      include: includePremium,
    });

    try {
      await processMatchRank(matchId);
    } catch (rankError) {
      console.error("Erro ao processar rank:", rankError);
      return res.status(500).json({
        message: "Partida finalizada, mas o rank falhou.",
        error: String(rankError),
      });
    }

    for (const participant of participants) {
      const didWin = !isDraw && winnerSide && participant?.teamSide === winnerSide;

      const feedType = isDraw ? "DRAW" : didWin ? "WIN" : "LOSS";
      const feedText = isDraw
        ? "Partida encerrada em empate. Cada ponto conta."
        : didWin
        ? "Saiu com a vitória e somou mais uma grande atuação."
        : "Partida encerrada. Hora de voltar mais forte na próxima.";

      await createFeedPost({
        userId: participant.userId,
        matchId,
        type: feedType,
        text: feedText,
        meta: {
          score: `${match.teamAScore} x ${match.teamBScore}`,
          arena: getArenaLabel(match),
          matchTitle: match?.title || "",
          winnerSide: isDraw ? null : winnerSide,
          isDraw,
        },
      });
    }

    return res.json(match);
  } catch (e) {
    return res
      .status(400)
      .json({ message: "Erro ao finalizar partida", error: String(e) });
  }
});

router.patch("/:id([a-z0-9]{20,})/cancel", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const ok = await canManageMatch(user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão" });

    const match = await prisma.match.update({
      where: { id: matchId },
      data: { status: "CANCELED", canceledAt: new Date() },
      include: includePremium,
    });

    return res.json(match);
  } catch (e) {
    return res
      .status(400)
      .json({ message: "Erro ao cancelar partida", error: String(e) });
  }
});

router.patch("/:id([a-z0-9]{20,})/uncancel", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const ok = await canManageMatch(user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão" });

    const match = await prisma.match.update({
      where: { id: matchId },
      data: { status: "SCHEDULED", canceledAt: null },
      include: includePremium,
    });

    return res.json(match);
  } catch (e) {
    return res
      .status(400)
      .json({ message: "Erro ao reativar partida", error: String(e) });
  }
});

/* ======================================================
   CONTROLLER / TEAMS
   ====================================================== */

router.patch("/:id([a-z0-9]{20,})/controller", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();
    const data = assignControllerSchema.parse(req.body);

    const ok = await canManageMatch(user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão" });

    if (data.controllerId) {
      const exists = await prisma.matchPresence.findFirst({
        where: { matchId, userId: data.controllerId },
        select: { id: true },
      });

      if (!exists) {
        return res.status(400).json({
          message: "O controlador precisa estar presente na partida",
        });
      }
    }

    const match = await prisma.match.update({
      where: { id: matchId },
      data: { controllerId: data.controllerId || null },
      include: includePremium,
    });

    return res.json(match);
  } catch (e) {
    return res.status(400).json({
      message: "Erro ao atualizar controlador",
      error: String(e),
    });
  }
});

router.patch("/:id([a-z0-9]{20,})/team-side", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();
    const data = assignTeamSideSchema.parse(req.body);

    const ok = await canManageMatch(user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão" });

    const presence = await prisma.matchPresence.findFirst({
      where: { matchId, userId: data.userId },
      select: { id: true },
    });

    if (!presence) {
      return res.status(404).json({ message: "Jogador não está na partida" });
    }

    await prisma.matchPresence.update({
      where: { id: presence.id },
      data: {
        teamSide: data.teamSide,
        ...(typeof data.isCaptain === "boolean"
          ? { isCaptain: data.isCaptain }
          : {}),
      },
    });

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    return res.json(match);
  } catch (e) {
    return res.status(400).json({
      message: "Erro ao atualizar lado do jogador",
      error: String(e),
    });
  }
});

/* ======================================================
   EVENTS
   ====================================================== */

router.get("/:id([a-z0-9]{20,})/events", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });

    if (!match) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    const events = await prisma.matchEvent.findMany({
      where: { matchId },
      orderBy: { createdAt: "asc" },
      include: {
        player: { select: { id: true, name: true, imageUrl: true } },
        assistPlayer: { select: { id: true, name: true, imageUrl: true } },
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });

    return res.json(events);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao buscar eventos",
      error: String(e),
    });
  }
});

router.post("/:id([a-z0-9]{20,})/events/goal", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();
    const data = goalEventSchema.parse(req.body);

    const match = await getControllerLockedMatch(matchId);

    if (!match) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    if (match.status !== "LIVE") {
      return res.status(409).json({
        message: "Partida não está em andamento",
      });
    }

    const isAllowed = await ensureOnlyControllerOrAdmin(user, match);
    if (!isAllowed) {
      return res.status(403).json({
        message: "Apenas o controlador pode registrar eventos",
      });
    }

    const totalGoals = await countConfirmedGoals(matchId);
    if (totalGoals >= 50) {
      return res.status(400).json({
        message: "Limite de gols atingido (segurança)",
      });
    }

    const playerInMatch = match.presences.find(
      (p) => p.userId === data.playerId
    );
    if (!playerInMatch) {
      return res.status(400).json({
        message: "Jogador não está na partida",
      });
    }

    if (playerInMatch.teamSide !== data.teamSide) {
      return res.status(400).json({
        message: "O jogador não pertence ao lado informado",
      });
    }

    if (data.assistPlayerId) {
      const assistInMatch = match.presences.find(
        (p) => p.userId === data.assistPlayerId
      );

      if (!assistInMatch) {
        return res.status(400).json({
          message: "Assistência inválida",
        });
      }

      if (data.assistPlayerId === data.playerId) {
        return res.status(400).json({
          message: "Jogador não pode assistir a si mesmo",
        });
      }

      if (assistInMatch.teamSide !== data.teamSide) {
        return res.status(400).json({
          message: "Assistência precisa ser do mesmo time",
        });
      }
    }

    const event = await prisma.matchEvent.create({
      data: {
        matchId,
        type: "GOAL",
        status: "CONFIRMED",
        teamSide: data.teamSide,
        playerId: data.playerId,
        assistPlayerId: data.assistPlayerId || null,
        minute: data.minute ?? null,
        notes: data.notes ?? null,
        createdById: user.id,
      },
      include: {
        player: { select: { id: true, name: true, imageUrl: true } },
        assistPlayer: { select: { id: true, name: true, imageUrl: true } },
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });

    const score = await recalcMatchScore(matchId);
    await rebuildOfficialStatsFromEvents(matchId);

    const updatedMatch = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    await createFeedPost({
      userId: data.playerId,
      matchId,
      type: "GOAL",
      text: "Marcou e deixou sua marca na partida.",
      meta: {
        score,
        arena: getArenaLabel(updatedMatch),
        matchTitle: updatedMatch?.title || "",
        minute: data.minute ?? null,
        opponent:
          data.teamSide === "A"
            ? updatedMatch?.teamBName || "Adversário"
            : updatedMatch?.teamAName || "Adversário",
      },
    });

    if (data.assistPlayerId) {
      await createFeedPost({
        userId: data.assistPlayerId,
        matchId,
        type: "ASSIST",
        text: "Distribuiu uma assistência decisiva.",
        meta: {
          score,
          arena: getArenaLabel(updatedMatch),
          matchTitle: updatedMatch?.title || "",
          minute: data.minute ?? null,
        },
      });
    }

    return res.json({
      event,
      score,
      match: updatedMatch,
    });
  } catch (e) {
    return res.status(400).json({
      message: "Erro ao registrar gol",
      error: String(e),
    });
  }
});

router.post("/:id([a-z0-9]{20,})/events/undo-last", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const match = await getControllerLockedMatch(matchId);
    if (!match) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    const isAllowed = await ensureOnlyControllerOrAdmin(user, match);
    if (!isAllowed) {
      return res.status(403).json({
        message: "Apenas o controlador pode desfazer eventos",
      });
    }

    const lastEvent = await prisma.matchEvent.findFirst({
      where: {
        matchId,
        type: "GOAL",
        status: "CONFIRMED",
      },
      orderBy: { createdAt: "desc" },
    });

    if (!lastEvent) {
      return res.status(404).json({
        message: "Nenhum evento confirmado encontrado",
      });
    }

    await prisma.matchEvent.update({
      where: { id: lastEvent.id },
      data: { status: "REMOVED" },
    });

    const score = await recalcMatchScore(matchId);
    await rebuildOfficialStatsFromEvents(matchId);

    const updatedMatch = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    return res.json({
      undoneEventId: lastEvent.id,
      score,
      match: updatedMatch,
    });
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao desfazer último evento",
      error: String(e),
    });
  }
});

/* ======================================================
   STATS
   ====================================================== */

router.get("/:id([a-z0-9]{20,})/stats", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();

    const stats = await prisma.matchPlayerStat.findMany({
      where: { matchId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: [
        { goalsOfficial: "desc" },
        { assistsOfficial: "desc" },
        { goalsUnofficial: "desc" },
        { assistsUnofficial: "desc" },
      ],
    });

    return res.json(stats);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao buscar estatísticas",
      error: String(e),
    });
  }
});

router.post("/:id([a-z0-9]{20,})/stats/event", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();
    const data = statEventSchema.parse(req.body);

    if (data.mode === "unofficial" && data.userId !== user.id) {
      return res.status(403).json({
        message:
          "Não-oficial só pode ser lançado pelo próprio jogador (pra evitar troll).",
      });
    }

    if (data.mode === "unofficial") {
      const inMatch = await isUserInMatch(user.id, matchId);
      if (!inMatch) {
        return res
          .status(403)
          .json({ message: "Você não está presente nesta partida" });
      }
    }

    if (data.mode === "official") {
      const canEdit = await canEditOfficialStats(user, matchId);
      if (!canEdit) {
        return res.status(403).json({
          message: "Sem permissão para lançar estatística oficial",
        });
      }
    }

    const updateFields =
      data.type === "goal"
        ? data.mode === "official"
          ? { goalsOfficial: { increment: data.delta } }
          : { goalsUnofficial: { increment: data.delta } }
        : data.mode === "official"
        ? { assistsOfficial: { increment: data.delta } }
        : { assistsUnofficial: { increment: data.delta } };

    const createdBase = {
      matchId,
      userId: data.userId,
      goalsOfficial: 0,
      assistsOfficial: 0,
      goalsUnofficial: 0,
      assistsUnofficial: 0,
      wins: 0,
    };

    if (data.type === "goal" && data.mode === "official") {
      createdBase.goalsOfficial = Math.max(0, data.delta);
    }
    if (data.type === "goal" && data.mode === "unofficial") {
      createdBase.goalsUnofficial = Math.max(0, data.delta);
    }
    if (data.type === "assist" && data.mode === "official") {
      createdBase.assistsOfficial = Math.max(0, data.delta);
    }
    if (data.type === "assist" && data.mode === "unofficial") {
      createdBase.assistsUnofficial = Math.max(0, data.delta);
    }

    const stat = await prisma.matchPlayerStat.upsert({
      where: { matchId_userId: { matchId, userId: data.userId } },
      create: createdBase,
      update: updateFields,
      include: { user: { select: { id: true, name: true } } },
    });

    const fixed = await prisma.matchPlayerStat.update({
      where: { id: stat.id },
      data: {
        goalsOfficial: Math.max(0, stat.goalsOfficial),
        assistsOfficial: Math.max(0, stat.assistsOfficial),
        goalsUnofficial: Math.max(0, stat.goalsUnofficial),
        assistsUnofficial: Math.max(0, stat.assistsUnofficial),
      },
      include: { user: { select: { id: true, name: true } } },
    });

    return res.json(fixed);
  } catch (e) {
    return res.status(400).json({
      message: "Erro ao lançar estatística",
      error: String(e),
    });
  }
});

/* ======================================================
   PRESENÇA
   ====================================================== */

router.post("/:id([a-z0-9]{20,})", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    if (!match) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    if (["CANCELED", "EXPIRED", "FINISHED"].includes(match.status)) {
      return res.status(409).json({
        message: `Partida ${match.status.toLowerCase()}.`,
      });
    }

    const maxPlayers = Number(match.maxPlayers || 0);
    const joinedNow = match.presences?.length || 0;
    if (maxPlayers > 0 && joinedNow >= maxPlayers) {
      return res.status(409).json({ message: "Partida lotada." });
    }

    const exists = await prisma.matchPresence.findFirst({
      where: { matchId, userId: user.id },
      select: { id: true },
    });

    if (!exists) {
      await prisma.matchPresence.create({
        data: { matchId, userId: user.id },
      });
    }

    const updated = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao confirmar presença",
      error: String(e),
    });
  }
});

router.delete("/:id([a-z0-9]{20,})", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    await prisma.matchPresence.deleteMany({
      where: { matchId, userId: user.id },
    });

    const updated = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    if (!updated) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao sair da presença",
      error: String(e),
    });
  }
});

router.post("/:id([a-z0-9]{20,})/join", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    if (!match) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    if (match.isPrivate) {
      const password = String(
        req.body?.password ||
          req.query?.password ||
          req.headers["x-match-password"] ||
          ""
      ).trim();

      if (!password) {
        return res.status(401).json({
          message: "Senha obrigatória para entrar nesta partida.",
        });
      }

      if (password !== String(match.accessPassword || "").trim()) {
        return res.status(401).json({
          message: "Senha inválida.",
        });
      }
    }

    if (["CANCELED", "EXPIRED", "FINISHED"].includes(match.status)) {
      return res.status(409).json({
        message: `Partida ${match.status.toLowerCase()}.`,
      });
    }

    const maxPlayers = Number(match.maxPlayers || 0);
    const joinedNow = match.presences?.length || 0;
    if (maxPlayers > 0 && joinedNow >= maxPlayers) {
      return res.status(409).json({ message: "Partida lotada." });
    }

    const exists = await prisma.matchPresence.findFirst({
      where: { matchId, userId: user.id },
      select: { id: true },
    });

    let createdPresence = false;

    if (!exists) {
      createdPresence = true;
      await prisma.matchPresence.create({
        data: { matchId, userId: user.id },
      });
    }

    const updated = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    if (createdPresence) {
      await createFeedPost({
        userId: user.id,
        matchId,
        type: "CHECKIN",
        text: "Confirmou presença e já está pronto para jogar.",
        meta: {
          arena: getArenaLabel(updated),
          matchTitle: updated?.title || "",
          date: updated?.date || null,
        },
      });
    }

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao confirmar presença",
      error: String(e),
    });
  }
});

router.delete("/:id([a-z0-9]{20,})/join", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    await prisma.matchPresence.deleteMany({
      where: { matchId, userId: user.id },
    });

    const updated = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    if (!updated) {
      return res.status(404).json({ message: "Partida não encontrada" });
    }

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao sair da presença",
      error: String(e),
    });
  }
});

/* ======================================================
   EXPIRE MANUAL
   ====================================================== */

router.patch("/:id([a-z0-9]{20,})/expire", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();

    const ok = await canManageMatch(req.user, matchId);
    if (!ok) {
      return res
        .status(403)
        .json({ message: "Sem permissão para expirar a partida" });
    }

    const updated = await prisma.match.update({
      where: { id: matchId },
      data: {
        status: "EXPIRED",
        canceledAt: new Date(),
      },
      include: includePremium,
    });

    return res.json(updated);
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao expirar partida",
      error: String(error),
    });
  }
});

/* ======================================================
   CHAT DA PARTIDA
   ====================================================== */

const messageSchema = z.object({
  text: z.string().min(1).max(600),
});

async function canAccessChat(user, matchId) {
  if (user?.role === "admin") return true;

  const manage = await canManageMatch(user, matchId);
  if (manage) return true;

  const inMatch = await isUserInMatch(user?.id, matchId);
  return Boolean(inMatch);
}

router.get("/:id([a-z0-9]{20,})/messages", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();

    const ok = await canAccessChat(req.user, matchId);
    if (!ok) {
      return res.status(403).json({
        message: "Sem permissão para ver o chat desta partida",
      });
    }

    const messages = await prisma.matchMessage.findMany({
      where: { matchId },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: { id: true, name: true, imageUrl: true, role: true },
        },
      },
    });

    return res.json(messages);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao buscar mensagens",
      error: String(e),
    });
  }
});

router.post("/:id([a-z0-9]{20,})/messages", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();
    const userId = req.user?.id;

    const ok = await canAccessChat(req.user, matchId);
    if (!ok) {
      return res.status(403).json({
        message: "Sem permissão para enviar mensagem nesta partida",
      });
    }

    const data = messageSchema.parse(req.body);

    const created = await prisma.matchMessage.create({
      data: {
        matchId,
        userId,
        text: data.text.trim(),
      },
      include: {
        user: {
          select: { id: true, name: true, imageUrl: true, role: true },
        },
      },
    });

    return res.status(201).json(created);
  } catch (e) {
    return res.status(400).json({
      message: "Erro ao enviar mensagem",
      error: String(e),
    });
  }
});

router.get("/:id([a-z0-9]{20,})/messages/since", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();
    const ok = await canAccessChat(req.user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão" });

    const afterRaw = String(req.query.after || "").trim();
    const after = afterRaw ? new Date(afterRaw) : null;

    const where =
      after && !Number.isNaN(after.getTime())
        ? { matchId, createdAt: { gt: after } }
        : { matchId };

    const messages = await prisma.matchMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: { id: true, name: true, role: true, imageUrl: true },
        },
      },
      take: 50,
    });

    return res.json(messages);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao buscar mensagens",
      error: String(e),
    });
  }
});

export default router;