import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();



// 🔎 Rota de verificação de versão (pra testar deploy)
router.get("/__version", (req, res) => {
  res.json({ ok: true, version: "matches_routes_presence_patch_v1" });
});

function isRole(user, roles = []) {
  return roles.includes(user?.role);
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
  date: z.string().min(5),
  type: z.enum(["FUTSAL", "FUT7"]).default("FUT7"),
  courtId: z.string().optional().nullable(),
  matchAddress: z.string().optional().nullable(),
  maxPlayers: z.number().int().min(2).max(40).optional(),
  pricePerPlayer: z.number().int().min(0).max(9999).optional(),
});

// GET /matches
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

    const matches = await prisma.match.findMany({
      orderBy: { date: "asc" },
      include: includePremium,
    });
    return res.json(matches);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar partidas", error: String(e) });
  }
});

// POST /matches (criar partida)
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

    if (!isManual) {
      const court = await prisma.court.findUnique({ where: { id: courtIdStr } });
      if (!court) {
        return res.status(400).json({ message: "Dados inválidos", error: "courtId não existe." });
      }

      if (isRole(user, ["arena_owner"]) && court.arenaOwnerId !== user.id) {
        return res.status(403).json({
          message: "Você só pode criar partidas nas suas próprias quadras",
        });
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
