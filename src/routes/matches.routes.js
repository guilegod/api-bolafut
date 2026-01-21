import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

const matchCreateSchema = z.object({
  title: z.string().min(2),
  date: z.string().min(10), // ISO string
  type: z.enum(["FUTSAL", "FUT7"]),
  courtId: z.string().optional().nullable(),
  matchAddress: z.string().optional().nullable(),
  maxPlayers: z.number().int().min(2).max(40).optional(),
  pricePerPlayer: z.number().int().min(0).max(9999).optional(),
});

// ✅ Include PREMIUM: presences já trazendo user.name (para o front não usar mock)
const includePremium = {
  court: true,
  presences: {
    select: {
      userId: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
  },
};

// helper: quem pode mexer na match
async function canManageMatch(user, matchId) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      organizerId: true,
      court: { select: { arenaOwnerId: true } },
      status: true,
    },
  });
  if (!match) return { ok: false, reason: "NOT_FOUND", match: null };

  const isAdmin = user?.role === "admin";
  const isOrganizerOwner = user?.role === "owner" && match.organizerId === user.id;
  const isArenaOwner = user?.role === "arena_owner" && match?.court?.arenaOwnerId === user.id;

  if (!isAdmin && !isOrganizerOwner && !isArenaOwner) {
    return { ok: false, reason: "FORBIDDEN", match };
  }

  return { ok: true, reason: "OK", match };
}

// ✅ GET /matches
// - admin: tudo
// - owner: só as dele
// - arena_owner: partidas das courts dele
// - user: retorna todas (públicas por enquanto)
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
        where: { court: { arenaOwnerId: user.id } },
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

    // ✅ USER: vê todas (inclusive CANCELLED; o front decide se esconde ou mostra)
    const matches = await prisma.match.findMany({
      orderBy: { date: "asc" },
      include: includePremium,
    });
    return res.json(matches);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar partidas", error: String(e) });
  }
});

// ✅ POST /matches (owner/admin)
// - permite manual (courtId null) => matchAddress obrigatório
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = matchCreateSchema.parse(req.body);

    const courtIdRaw = data.courtId ?? null;
    const courtIdStr = courtIdRaw ? String(courtIdRaw).trim() : "";

    const isManual =
      !courtIdStr ||
      courtIdStr === "" ||
      courtIdStr.toLowerCase() === "null" ||
      courtIdStr.toLowerCase() === "none" ||
      courtIdStr.toLowerCase() === "undefined" ||
      courtIdStr.toLowerCase() === "manual";

    const addr = (data.matchAddress ?? "").toString().trim() || null;

    if (isManual && !addr) {
      return res.status(400).json({
        message: "Dados inválidos",
        error: "matchAddress é obrigatório quando courtId é null (match manual).",
      });
    }

    if (!isManual) {
      const court = await prisma.court.findUnique({ where: { id: courtIdStr } });
      if (!court) {
        return res.status(400).json({ message: "Dados inválidos", error: "courtId não existe." });
      }
    }

    const match = await prisma.match.create({
      data: {
        title: data.title,
        date: new Date(data.date),
        type: data.type,
        organizerId: user.id,
        courtId: isManual ? null : courtIdStr,
        matchAddress: addr,
        maxPlayers: data.maxPlayers ?? 14,
        pricePerPlayer: data.pricePerPlayer ?? 30,

        // ✅ NOVO
        status: "SCHEDULED",
      },
      include: includePremium,
    });

    return res.status(201).json(match);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

// ✅ PATCH /matches/:id/cancel  (cancelar sem apagar)
router.patch("/:id/cancel", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    const perm = await canManageMatch(user, matchId);
    if (!perm.match) return res.status(404).json({ message: "Partida não encontrada" });
    if (!perm.ok) return res.status(403).json({ message: "Sem permissão para cancelar essa partida" });

    if (perm.match.status === "CANCELLED") {
      const updated = await prisma.match.findUnique({ where: { id: matchId }, include: includePremium });
      return res.json(updated);
    }

    const updated = await prisma.match.update({
      where: { id: matchId },
      data: { status: "CANCELLED" },
      include: includePremium,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao cancelar partida", error: String(e) });
  }
});

// ✅ PATCH /matches/:id/uncancel (reativar)
router.patch("/:id/uncancel", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    const perm = await canManageMatch(user, matchId);
    if (!perm.match) return res.status(404).json({ message: "Partida não encontrada" });
    if (!perm.ok) return res.status(403).json({ message: "Sem permissão para reativar essa partida" });

    const updated = await prisma.match.update({
      where: { id: matchId },
      data: { status: "SCHEDULED" },
      include: includePremium,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao reativar partida", error: String(e) });
  }
});

// ✅ DELETE /matches/:id  (excluir de vez)
router.delete("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    const perm = await canManageMatch(user, matchId);
    if (!perm.match) return res.status(404).json({ message: "Partida não encontrada" });
    if (!perm.ok) return res.status(403).json({ message: "Sem permissão para excluir essa partida" });

    // presences já apagam por cascade (no schema)
    await prisma.match.delete({ where: { id: matchId } });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Erro ao excluir partida", error: String(e) });
  }
});

// ✅ POST /matches/:id/join  (presença persistente)
router.post("/:id/join", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        maxPlayers: true,
        status: true,
        presences: { select: { userId: true } },
      },
    });
    if (!match) return res.status(404).json({ message: "Partida não encontrada" });

    // ✅ NOVO: bloqueia entrar em partida cancelada
    if (match.status === "CANCELLED") {
      return res.status(409).json({ message: "Essa partida foi cancelada" });
    }

    const already = match.presences.some((p) => p.userId === user.id);

    // limite de vagas (se já está dentro, ok)
    if (!already && match.presences.length >= match.maxPlayers) {
      return res.status(409).json({ message: "Partida lotada" });
    }

    await prisma.matchPresence.upsert({
      where: { userId_matchId: { userId: user.id, matchId } },
      update: {},
      create: { userId: user.id, matchId },
    });

    const updated = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao confirmar presença", error: String(e) });
  }
});

// ✅ POST /matches/:id/leave
router.post("/:id/leave", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    await prisma.matchPresence.deleteMany({
      where: { userId: user.id, matchId },
    });

    const updated = await prisma.match.findUnique({
      where: { id: matchId },
      include: includePremium,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao sair da partida", error: String(e) });
  }
});

export default router;
