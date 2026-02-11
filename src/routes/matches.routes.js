import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

// 🔎 Rota de verificação de versão (pra testar deploy)
router.get("/__version", (req, res) => {
  res.json({ ok: true, version: "matches_routes_v8_peladas_secure_join_max" });
});

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

/* ======================================================
   INCLUDES
   - includePremium: rotas autenticadas (pode ter email)
   - includePublic: rotas públicas (SEM email)
   ====================================================== */

const includePremium = {
  court: {
    include: {
      arena: true, // ✅ importante (court.arena.ownerId)
    },
  },
  presences: {
    select: {
      id: true,
      userId: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  },
  organizer: { select: { id: true, name: true, email: true, role: true } },
};

const includePublic = {
  court: {
    include: {
      arena: true,
    },
  },
  presences: {
    select: {
      id: true,
      userId: true,
      createdAt: true,
      user: { select: { id: true, name: true, role: true } }, // ✅ sem email
    },
  },
  organizer: { select: { id: true, name: true, role: true } }, // ✅ sem email
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

  // ✅ OBRIGATÓRIO (sem modo manual)
  courtId: z.string().min(3),

  // ✅ Diferencia reserva vs pelada (ideal ter Match.kind no schema)
  kind: z.enum(["BOOKING", "PELADA"]).optional(),

  // ✅ aceita string vinda do front ("14") e converte em number
  maxPlayers: z.coerce.number().int().min(2).max(40).optional(),
  pricePerPlayer: z.coerce.number().int().min(0).max(9999).optional(),
  minPlayers: z.coerce.number().int().min(0).max(40).optional(),
});

// helpers
function addMinutes(date, minutes) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/* ======================================================
   ✅ STATS HELPERS
   ====================================================== */

async function canEditOfficialStats(user, matchId) {
  if (user?.role === "admin") return true;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      organizerId: true,
      court: {
        select: {
          arenaOwnerId: true, // legado
          arena: { select: { ownerId: true } }, // novo
        },
      },
    },
  });

  if (!match) return false;

  if (user?.role === "owner" && match.organizerId === user.id) return true;

  if (user?.role === "arena_owner") {
    const legacyOk = match.court?.arenaOwnerId === user.id;
    const newOk = match.court?.arena?.ownerId === user.id;
    return Boolean(legacyOk || newOk);
  }

  return false;
}

async function isUserInMatch(userId, matchId) {
  const presence = await prisma.matchPresence.findFirst({
    where: { matchId, userId },
    select: { id: true },
  });
  return Boolean(presence);
}

const statEventSchema = z.object({
  userId: z.string().min(5),
  type: z.enum(["goal", "assist"]),
  mode: z.enum(["official", "unofficial"]),
  delta: z.number().int().min(-1).max(1),
});

/* ======================================================
   ✅ MATCH STATUS HELPERS
   ====================================================== */

async function canManageMatch(user, matchId) {
  if (user?.role === "admin") return true;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      organizerId: true,
      court: {
        select: {
          arenaOwnerId: true,
          arena: { select: { ownerId: true } },
        },
      },
    },
  });

  if (!match) return false;

  if (user?.role === "owner" && match.organizerId === user.id) return true;

  if (user?.role === "arena_owner") {
    const legacyOk = match.court?.arenaOwnerId === user.id;
    const newOk = match.court?.arena?.ownerId === user.id;
    return Boolean(legacyOk || newOk);
  }

  return false;
}

/**
 * Auto-expire:
 * - status = SCHEDULED
 * - passou do horário + 30min
 * - minPlayers > 0
 * - presences < minPlayers
 */
async function maybeAutoExpireMatch(matchId, opts = {}) {
  const { returnUpdatedOnly = false, currentMatch = null, include = includePremium } = opts;

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

/* ======================================================
   ✅ PELADAS (públicas)
   - ESTE BLOCO PRECISA VIR ANTES DE "/:id"
   ====================================================== */

// GET /matches/peladas (public)
router.get("/peladas", async (req, res) => {
  try {
    const arenaId = req.query.arenaId ? String(req.query.arenaId) : null;
    const arenaSlug = req.query.slug ? String(req.query.slug) : null;
    const courtId = req.query.courtId ? String(req.query.courtId) : null;

    const dateStr = req.query.date ? String(req.query.date) : null; // "YYYY-MM-DD" ou ISO
    const fromStr = req.query.from ? String(req.query.from) : null;
    const toStr = req.query.to ? String(req.query.to) : null;

    let from = null;
    let to = null;

    if (fromStr) from = new Date(fromStr);
    if (toStr) to = new Date(toStr);

    if (!from && !to && dateStr) {
      const d = new Date(dateStr);
      if (!Number.isNaN(d.getTime())) {
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        from = start;
        to = end;
      }
    }

    const where = {
      kind: "PELADA",
      ...(courtId ? { courtId } : {}),
      ...(from || to
        ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
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
      include: includePublic, // ✅ sem email
      take: 200,
    });

    const updated = [];
    for (const m of peladas) {
      const maybe = await maybeAutoExpireMatch(m.id, {
        returnUpdatedOnly: false,
        currentMatch: m,
        include: includePublic,
      });
      updated.push(maybe || m);
    }

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar peladas", error: String(e) });
  }
});

// POST /matches/peladas (auth) — cria pelada (qualquer usuário logado)
router.post("/peladas", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const data = matchCreateSchema.parse({ ...req.body, kind: "PELADA" });

    const courtIdStr = String(data.courtId || "").trim();

    const matchStart = new Date(data.date);
    if (Number.isNaN(matchStart.getTime())) {
      return res.status(400).json({ message: "Dados inválidos", error: "date inválido." });
    }

    const matchEnd = addMinutes(matchStart, 60);

    const court = await prisma.court.findUnique({
      where: { id: courtIdStr },
      include: { arena: true },
    });

    if (!court) {
      return res.status(400).json({ message: "Dados inválidos", error: "courtId não existe." });
    }

    // Conflito com Reservation
    const conflictReservation = await prisma.reservation.findFirst({
      where: {
        courtId: courtIdStr,
        status: { not: "CANCELED" },
        startAt: { lt: matchEnd },
        endAt: { gt: matchStart },
      },
      select: { id: true, startAt: true, endAt: true, status: true, paymentStatus: true },
    });

    if (conflictReservation) {
      return res.status(409).json({
        message: "Horário já reservado (Reservation)",
        conflict: { type: "reservation", ...conflictReservation },
      });
    }

    // Conflito com Match (pelada ou booking)
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
        courtId: courtIdStr,

        maxPlayers: data.maxPlayers ?? 14,
        minPlayers: data.minPlayers ?? 0,
        pricePerPlayer: data.pricePerPlayer ?? 30,
        status: "SCHEDULED",
        kind: "PELADA",
      },
      include: includePremium,
    });

    // criador já entra
    await prisma.matchPresence.create({ data: { matchId: match.id, userId: user.id } });

    const updated = await prisma.match.findUnique({
      where: { id: match.id },
      include: includePremium,
    });

    return res.status(201).json(updated || match);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

/* ======================================================
   GET /matches (SEGURO)
   - admin: tudo
   - arena_owner: matches das quadras dele
   - owner: matches criados por ele
   - user: só matches onde ele está presente
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
    return res.status(500).json({ message: "Erro ao listar partidas", error: String(e) });
  }
});

/* ======================================================
   GET /matches/:id  (BLINDADO: evita pegar "peladas")
   - como ID é CUID padrão, casa só com [a-z0-9]{20,}
   ====================================================== */
router.get("/:id([a-z0-9]{20,})", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();

    const match = await maybeAutoExpireMatch(matchId, {
      returnUpdatedOnly: false,
      currentMatch: null,
      include: includePremium,
    });

    if (!match) return res.status(404).json({ message: "Partida não encontrada" });
    return res.json(match);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao buscar partida", error: String(e) });
  }
});

/* ======================================================
   POST /matches (criar partida) — SEM MANUAL (BOOKING)
   ====================================================== */
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["owner", "arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = matchCreateSchema.parse(req.body);
    const courtIdStr = String(data.courtId || "").trim();

    const matchStart = new Date(data.date);
    if (Number.isNaN(matchStart.getTime())) {
      return res.status(400).json({ message: "Dados inválidos", error: "date inválido." });
    }

    const matchEnd = addMinutes(matchStart, 60);

    const court = await prisma.court.findUnique({
      where: { id: courtIdStr },
      include: { arena: true },
    });

    if (!court) {
      return res.status(400).json({ message: "Dados inválidos", error: "courtId não existe." });
    }

    // arena_owner só cria nas quadras dele (legado ou novo)
    if (isRole(user, ["arena_owner"])) {
      const legacyOk = court.arenaOwnerId === user.id;
      const newOk = court.arena?.ownerId === user.id;
      if (!legacyOk && !newOk) {
        return res.status(403).json({
          message: "Você só pode criar partidas nas suas próprias quadras",
        });
      }
    }

    // 1) Conflict com Reservation
    const conflictReservation = await prisma.reservation.findFirst({
      where: {
        courtId: courtIdStr,
        status: { not: "CANCELED" },
        startAt: { lt: matchEnd },
        endAt: { gt: matchStart },
      },
      select: { id: true, startAt: true, endAt: true, status: true, paymentStatus: true },
    });

    if (conflictReservation) {
      return res.status(409).json({
        message: "Horário já reservado (Reservation)",
        conflict: { type: "reservation", ...conflictReservation },
      });
    }

    // 2) Conflict com outro Match
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
        courtId: courtIdStr,

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
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

/* ======================================================
   ✅ MATCH STATUS: start / finish / cancel / uncancel
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
    return res.status(400).json({ message: "Erro ao iniciar partida", error: String(e) });
  }
});

router.patch("/:id([a-z0-9]{20,})/finish", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const ok = await canManageMatch(user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão" });

    const match = await prisma.match.update({
      where: { id: matchId },
      data: { status: "FINISHED", finishedAt: new Date() },
      include: includePremium,
    });

    return res.json(match);
  } catch (e) {
    return res.status(400).json({ message: "Erro ao finalizar partida", error: String(e) });
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
    return res.status(400).json({ message: "Erro ao cancelar partida", error: String(e) });
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
    return res.status(400).json({ message: "Erro ao reativar partida", error: String(e) });
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
    return res.status(500).json({ message: "Erro ao buscar estatísticas", error: String(e) });
  }
});

router.post("/:id([a-z0-9]{20,})/stats/event", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();
    const data = statEventSchema.parse(req.body);

    if (data.mode === "unofficial" && data.userId !== user.id) {
      return res.status(403).json({
        message: "Não-oficial só pode ser lançado pelo próprio jogador (pra evitar troll).",
      });
    }

    if (data.mode === "unofficial") {
      const inMatch = await isUserInMatch(user.id, matchId);
      if (!inMatch) return res.status(403).json({ message: "Você não está presente nesta partida" });
    }

    if (data.mode === "official") {
      const canEdit = await canEditOfficialStats(user, matchId);
      if (!canEdit) return res.status(403).json({ message: "Sem permissão para lançar estatística oficial" });
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
    };

    if (data.type === "goal" && data.mode === "official") createdBase.goalsOfficial = Math.max(0, data.delta);
    if (data.type === "goal" && data.mode === "unofficial") createdBase.goalsUnofficial = Math.max(0, data.delta);
    if (data.type === "assist" && data.mode === "official") createdBase.assistsOfficial = Math.max(0, data.delta);
    if (data.type === "assist" && data.mode === "unofficial") createdBase.assistsUnofficial = Math.max(0, data.delta);

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
    return res.status(400).json({ message: "Erro ao lançar estatística", error: String(e) });
  }
});

/* ======================================================
   PRESENÇA
   ✅ inclui trava lotação (maxPlayers)
   ====================================================== */

router.post("/:id([a-z0-9]{20,})", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    if (!match) return res.status(404).json({ message: "Partida não encontrada" });

    if (["CANCELED", "EXPIRED", "FINISHED"].includes(match.status)) {
      return res.status(409).json({ message: `Partida ${match.status.toLowerCase()}.` });
    }

    // ✅ trava lotação
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
      await prisma.matchPresence.create({ data: { matchId, userId: user.id } });
    }

    const updated = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao confirmar presença", error: String(e) });
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

    if (!updated) return res.status(404).json({ message: "Partida não encontrada" });
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao sair da presença", error: String(e) });
  }
});

// ✅ Preferir /:id/join e DELETE /:id/join no app (mesma lógica)
router.post("/:id([a-z0-9]{20,})/join", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });
    if (!match) return res.status(404).json({ message: "Partida não encontrada" });

    if (["CANCELED", "EXPIRED", "FINISHED"].includes(match.status)) {
      return res.status(409).json({ message: `Partida ${match.status.toLowerCase()}.` });
    }

    // ✅ trava lotação
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
      await prisma.matchPresence.create({ data: { matchId, userId: user.id } });
    }

    const updated = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao confirmar presença", error: String(e) });
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

    if (!updated) return res.status(404).json({ message: "Partida não encontrada" });
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao sair da presença", error: String(e) });
  }
});

/* ======================================================
   EXPIRE MANUAL
   ====================================================== */
router.patch("/:id([a-z0-9]{20,})/expire", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();

    const ok = await canManageMatch(req.user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão para expirar a partida" });

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
    return res.status(500).json({ message: "Erro ao expirar partida", error: String(error) });
  }
});

/* ======================================================
   💬 CHAT DA PARTIDA (MatchMessage)
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

// GET /matches/:id/messages
router.get("/:id([a-z0-9]{20,})/messages", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();

    const ok = await canAccessChat(req.user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão para ver o chat desta partida" });

    const messages = await prisma.matchMessage.findMany({
      where: { matchId },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, name: true, imageUrl: true, role: true } },
      },
    });

    return res.json(messages);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao buscar mensagens", error: String(e) });
  }
});

// POST /matches/:id/messages
router.post("/:id([a-z0-9]{20,})/messages", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();
    const userId = req.user?.id;

    const ok = await canAccessChat(req.user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão para enviar mensagem nesta partida" });

    const data = messageSchema.parse(req.body);

    const created = await prisma.matchMessage.create({
      data: {
        matchId,
        userId,
        text: data.text.trim(),
      },
      include: {
        user: { select: { id: true, name: true, imageUrl: true, role: true } },
      },
    });

    return res.status(201).json(created);
  } catch (e) {
    return res.status(400).json({ message: "Erro ao enviar mensagem", error: String(e) });
  }
});

// GET /matches/:id/messages/since?after=ISO
router.get("/:id([a-z0-9]{20,})/messages/since", authRequired, async (req, res) => {
  try {
    const matchId = String(req.params.id || "").trim();
    const ok = await canAccessChat(req.user, matchId);
    if (!ok) return res.status(403).json({ message: "Sem permissão" });

    const afterRaw = String(req.query.after || "").trim();
    const after = afterRaw ? new Date(afterRaw) : null;

    const where =
      after && !Number.isNaN(after.getTime()) ? { matchId, createdAt: { gt: after } } : { matchId };

    const messages = await prisma.matchMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, role: true, imageUrl: true } } },
      take: 50,
    });

    return res.json(messages);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao buscar mensagens", error: String(e) });
  }
});

export default router;
