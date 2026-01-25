import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

// 🔎 Rota de verificação de versão (pra testar deploy)
router.get("/__version", (req, res) => {
  res.json({ ok: true, version: "matches_routes_v3_stats_official_unofficial" });
});

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

const includePremium = {
  court: {
    include: {
      arena: true, // ✅ importante pro arena_owner novo (court.arena.ownerId)
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
  courtId: z.string().optional().nullable(),
  matchAddress: z.string().optional().nullable(),
  maxPlayers: z.number().int().min(2).max(40).optional(),
  pricePerPlayer: z.number().int().min(0).max(9999).optional(),
});

// helpers (conflito)
function addMinutes(date, minutes) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/* ======================================================
   ✅ STATS HELPERS (Oficial / Não-oficial)
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

  // organizador da partida
  if (user?.role === "owner" && match.organizerId === user.id) return true;

  // dono da arena (legado ou novo)
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
   GET /matches
   ====================================================== */
router.get("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (isRole(user, ["admin"])) {
      const matches = await prisma.match.findMany({
        orderBy: { date: "asc" },
        include: includePremium,
      });
      return res.json(matches);
    }

    if (isRole(user, ["arena_owner"])) {
      const matches = await prisma.match.findMany({
        where: {
          court: {
            OR: [
              { arenaOwnerId: user.id }, // legado
              { arena: { ownerId: user.id } }, // novo
            ],
          },
        },
        orderBy: { date: "asc" },
        include: includePremium,
      });
      return res.json(matches);
    }

    if (isRole(user, ["owner"])) {
      const matches = await prisma.match.findMany({
        where: { organizerId: user.id },
        orderBy: { date: "asc" },
        include: includePremium,
      });
      return res.json(matches);
    }

    const matches = await prisma.match.findMany({
      orderBy: { date: "asc" },
      include: includePremium,
    });
    return res.json(matches);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar partidas", error: String(e) });
  }
});

/* ======================================================
   POST /matches (criar partida)
   ====================================================== */
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["owner", "arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = matchCreateSchema.parse(req.body);

    const courtIdRaw = data.courtId ?? null;
    const courtIdStr = courtIdRaw ? String(courtIdRaw).trim() : "";

    const isManual =
      !courtIdStr ||
      ["null", "none", "undefined", "manual", "__manual__"].includes(courtIdStr.toLowerCase());

    // arena_owner não pode criar partida manual
    if (isManual && isRole(user, ["arena_owner"])) {
      return res.status(403).json({
        message: "Dono de arena não pode criar partida em local manual",
      });
    }

    const addr = (data.matchAddress ?? "").toString().trim() || null;

    if (isManual && !addr) {
      return res.status(400).json({
        message: "Dados inválidos",
        error: "matchAddress é obrigatório quando courtId é null.",
      });
    }

    // ✅ data válida
    const matchStart = new Date(data.date);
    if (Number.isNaN(matchStart.getTime())) {
      return res.status(400).json({ message: "Dados inválidos", error: "date inválido." });
    }

    // ✅ duração padrão do match = 60min
    const matchEnd = addMinutes(matchStart, 60);

    if (!isManual) {
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

      // 1) Conflict com Reservation (não cancelada)
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

      // 2) Conflict com outro Match (assumindo 60min)
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
    }

    const match = await prisma.match.create({
      data: {
        title: data.title,
        date: matchStart,
        type: data.type,
        organizerId: user.id,
        courtId: isManual ? null : courtIdStr,
        matchAddress: addr,
        maxPlayers: data.maxPlayers ?? 14,
        pricePerPlayer: data.pricePerPlayer ?? 30,
      },
      include: includePremium,
    });

    return res.status(201).json(match);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

/* ======================================================
   ✅ STATS
   ====================================================== */

// GET /matches/:id/stats  -> placar completo
router.get("/:id/stats", authRequired, async (req, res) => {
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

// POST /matches/:id/stats/event -> lançar gol/assist
router.post("/:id/stats/event", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();
    const data = statEventSchema.parse(req.body);

    // ✅ Não-oficial: só o próprio jogador pode lançar pra si
    if (data.mode === "unofficial" && data.userId !== user.id) {
      return res.status(403).json({
        message: "Não-oficial só pode ser lançado pelo próprio jogador (pra evitar troll).",
      });
    }

    // ✅ Não-oficial: precisa estar presente
    if (data.mode === "unofficial") {
      const inMatch = await isUserInMatch(user.id, matchId);
      if (!inMatch) {
        return res.status(403).json({ message: "Você não está presente nesta partida" });
      }
    }

    // ✅ Oficial: precisa permissão (organizador / arena_owner / admin)
    if (data.mode === "official") {
      const canEdit = await canEditOfficialStats(user, matchId);
      if (!canEdit) {
        return res.status(403).json({ message: "Sem permissão para lançar estatística oficial" });
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
    };

    // cria já com o delta (evita criar e depois update)
    if (data.type === "goal" && data.mode === "official") createdBase.goalsOfficial = Math.max(0, data.delta);
    if (data.type === "goal" && data.mode === "unofficial") createdBase.goalsUnofficial = Math.max(0, data.delta);
    if (data.type === "assist" && data.mode === "official") createdBase.assistsOfficial = Math.max(0, data.delta);
    if (data.type === "assist" && data.mode === "unofficial") createdBase.assistsUnofficial = Math.max(0, data.delta);

    const stat = await prisma.matchPlayerStat.upsert({
      where: {
        matchId_userId: {
          matchId,
          userId: data.userId,
        },
      },
      create: createdBase,
      update: updateFields,
      include: { user: { select: { id: true, name: true } } },
    });

    // trava pra nunca ficar negativo
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
   PRESENÇA (LEGACY)
   Seu front está chamando: POST /matches/:id
   Então vamos garantir compatibilidade total.
   ====================================================== */

// POST /matches/:id  -> confirmar presença (idempotente)
router.post("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    if (!match) return res.status(404).json({ message: "Partida não encontrada" });

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
    return res.status(500).json({ message: "Erro ao confirmar presença", error: String(e) });
  }
});

// DELETE /matches/:id -> sair da presença
router.delete("/:id", authRequired, async (req, res) => {
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

// ======================================================
// PRESENÇA (OFICIAL) — rotas explícitas
// POST   /matches/:id/join   -> confirmar presença
// DELETE /matches/:id/join   -> sair da presença
// ======================================================

router.post("/:id/join", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = String(req.params.id || "").trim();

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });
    if (!match) return res.status(404).json({ message: "Partida não encontrada" });

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
    return res.status(500).json({ message: "Erro ao confirmar presença", error: String(e) });
  }
});

router.delete("/:id/join", authRequired, async (req, res) => {
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

export default router;
