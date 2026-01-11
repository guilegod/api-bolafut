import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

// ✅ GET /matches
// - admin: tudo
// - owner: só as dele
// - arena_owner: partidas das courts dele
// - user: por enquanto, retorna todas (públicas)
//   (depois você pode trocar por where: { isPublic: true } se existir)
router.get("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (isRole(user, ["admin"])) {
      const matches = await prisma.match.findMany({
        include: { court: true },
        orderBy: { date: "asc" },
      });
      return res.json(matches);
    }

    if (isRole(user, ["owner"])) {
      const matches = await prisma.match.findMany({
        where: { organizerId: user.id },
        include: { court: true },
        orderBy: { date: "asc" },
      });
      return res.json(matches);
    }

    if (isRole(user, ["arena_owner"])) {
      const matches = await prisma.match.findMany({
        where: { court: { arenaOwnerId: user.id } },
        include: { court: true },
        orderBy: { date: "asc" },
      });
      return res.json(matches);
    }

    // ✅ user comum: retorna todas por enquanto
    const matches = await prisma.match.findMany({
      include: { court: true },
      orderBy: { date: "asc" },
    });
    return res.json(matches);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar partidas", error: String(e) });
  }
});

const matchSchema = z.object({
  title: z.string().min(2),
  date: z.string(), // ISO
  time: z.string().optional(),
  courtId: z.string().optional().nullable(),
  type: z.enum(["FUTSAL", "FUT7"]).optional(),
  matchAddress: z.string().optional().nullable(),
  maxPlayers: z.number().int().min(2).optional(),
  pricePerPlayer: z.number().int().min(0).optional(),
});

// ✅ POST /matches
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = matchSchema.parse(req.body);

    const hasCourt = !!(data.courtId && String(data.courtId).trim());

    // =========================
    // Caso 1: match com arena
    // =========================
    if (hasCourt) {
      const courtId = String(data.courtId);

      const court = await prisma.court.findUnique({ where: { id: courtId } });
      if (!court) return res.status(400).json({ message: "Arena inválida (courtId não existe)" });

      // valida parceria (organizador só pode usar arenas liberadas)
      if (isRole(user, ["owner"])) {
        const allowed = await prisma.partnerArena.findUnique({
          where: { organizerId_courtId: { organizerId: user.id, courtId } },
        });
        if (!allowed) {
          return res
            .status(403)
            .json({ message: "Você não tem permissão para criar partida nessa arena" });
        }
      }

      const match = await prisma.match.create({
        data: {
          title: data.title,
          date: new Date(data.date),
          organizerId: user.id,
          courtId: courtId,

          // ✅ tipo vem da court (fonte de verdade)
          type: court.type,

          matchAddress: data.matchAddress ?? null,

          maxPlayers: data.maxPlayers ?? 14,
          pricePerPlayer: data.pricePerPlayer ?? 30,
        },
        include: { court: true },
      });

      return res.status(201).json(match);
    }

    // =========================
    // Caso 2: match local manual
    // =========================
    const addr = String(data.matchAddress || "").trim();
    if (!addr) {
      return res.status(400).json({ message: "Para local manual, informe matchAddress" });
    }

    const type = data.type || "FUTSAL";

    const match = await prisma.match.create({
      data: {
        title: data.title,
        date: new Date(data.date),
        organizerId: user.id,
        courtId: null,
        type,
        matchAddress: addr,
        maxPlayers: data.maxPlayers ?? 14,
        pricePerPlayer: data.pricePerPlayer ?? 30,
      },
      include: { court: true },
    });

    return res.status(201).json(match);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

export default router;
