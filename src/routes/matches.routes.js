import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

function canManageMatch(user, match) {
  if (!user) return false;
  if (isRole(user, ["admin"])) return true;
  // organizador só pode mexer nas partidas dele
  if (isRole(user, ["owner"]) && match?.organizerId === user.id) return true;
  return false;
}

const includePremium = {
  court: true,
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
  date: z.string().min(5), // ISO
  type: z.enum(["FUTSAL", "FUT7"]).default("FUT7"),
  courtId: z.string().optional().nullable(),
  matchAddress: z.string().optional().nullable(),
  maxPlayers: z.number().int().min(2).max(40).optional(),
  pricePerPlayer: z.number().int().min(0).max(9999).optional(),
});

// ✅ GET /matches
router.get("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    // admin vê tudo
    if (isRole(user, ["admin"])) {
      const matches = await prisma.match.findMany({
        orderBy: { date: "asc" },
        include: includePremium,
      });
      return res.json(matches);
    }

    // arena_owner vê só partidas nas quadras dele
    if (isRole(user, ["arena_owner"])) {
      const matches = await prisma.match.findMany({
        where: { court: { arenaOwnerId: user.id } },
        orderBy: { date: "asc" },
        include: includePremium,
      });
      return res.json(matches);
    }

    // owner (organizador) vê só as dele
    if (isRole(user, ["owner"])) {
      const matches = await prisma.match.findMany({
        where: { organizerId: user.id },
        orderBy: { date: "asc" },
        include: includePremium,
      });
      return res.json(matches);
    }

    // user: por enquanto vê todas
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
      },
      include: includePremium,
    });

    return res.status(201).json(match);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

// ✅ PATCH /matches/:id/cancel  (owner/admin)
router.patch("/:id/cancel", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return res.status(404).json({ message: "Partida não encontrada" });

    if (!canManageMatch(user, match)) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const updated = await prisma.match.update({
      where: { id: matchId },
      data: { isCanceled: true, canceledAt: new Date() },
      include: includePremium,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao cancelar", error: String(e) });
  }
});

// ✅ PATCH /matches/:id/uncancel  (owner/admin)
router.patch("/:id/uncancel", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return res.status(404).json({ message: "Partida não encontrada" });

    if (!canManageMatch(user, match)) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const updated = await prisma.match.update({
      where: { id: matchId },
      data: { isCanceled: false, canceledAt: null },
      include: includePremium,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao reativar", error: String(e) });
  }
});

// ✅ DELETE /matches/:id (owner/admin)
router.delete("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return res.status(404).json({ message: "Partida não encontrada" });

    if (!canManageMatch(user, match)) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    await prisma.match.delete({ where: { id: matchId } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Erro ao excluir partida", error: String(e) });
  }
});

// ✅ POST /matches/:id/join
router.post("/:id/join", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        maxPlayers: true,
        isCanceled: true,
        presences: { select: { userId: true } },
      },
    });
    if (!match) return res.status(404).json({ message: "Partida não encontrada" });
    if (match.isCanceled) return res.status(409).json({ message: "Partida cancelada" });

    const already = match.presences.some((p) => p.userId === user.id);
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
