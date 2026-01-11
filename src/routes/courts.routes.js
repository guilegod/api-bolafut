import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

// ✅ GET /courts
// - arena_owner: só as dele
// - owner (organizador): só parceiras (PartnerArena)
// - admin: tudo
router.get("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (isRole(user, ["admin"])) {
      const courts = await prisma.court.findMany({ orderBy: { createdAt: "desc" } });
      return res.json(courts);
    }

    if (isRole(user, ["arena_owner"])) {
      const courts = await prisma.court.findMany({
        where: { arenaOwnerId: user.id },
        orderBy: { createdAt: "desc" },
      });
      return res.json(courts);
    }

    // organizador (owner): só arenas parceiras
    if (isRole(user, ["owner"])) {
      const partnerships = await prisma.partnerArena.findMany({
        where: { organizerId: user.id },
        include: { court: true },
        orderBy: { createdAt: "desc" },
      });

      const courts = partnerships.map((p) => p.court);
      return res.json(courts);
    }

    // user comum: por enquanto retorna vazio (mais seguro)
    return res.json([]);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar arenas", error: String(e) });
  }
});

const courtSchema = z.object({
  name: z.string().min(2),
  type: z.enum(["FUTSAL", "FUT7"]).optional(),
  city: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

// ✅ POST /courts (somente arena_owner ou admin)
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;
    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = courtSchema.parse(req.body);

    const court = await prisma.court.create({
      data: {
        name: data.name,
        type: data.type || "FUTSAL",
        city: data.city ?? null,
        address: data.address ?? null,
        arenaOwnerId: isRole(user, ["admin"]) ? (req.body.arenaOwnerId || null) : user.id,
      },
    });

    return res.status(201).json(court);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

// ✅ PATCH /courts/:id (arena_owner edita só as dele, admin edita tudo)
router.patch("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const id = req.params.id;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const patchSchema = courtSchema.partial();
    const data = patchSchema.parse(req.body);

    const court = await prisma.court.findUnique({ where: { id } });
    if (!court) return res.status(404).json({ message: "Arena não encontrada" });

    if (isRole(user, ["arena_owner"]) && court.arenaOwnerId !== user.id) {
      return res.status(403).json({ message: "Você não pode editar esta arena" });
    }

    const updated = await prisma.court.update({
      where: { id },
      data: {
        name: data.name ?? undefined,
        type: data.type ?? undefined,
        city: data.city ?? undefined,
        address: data.address ?? undefined,
      },
    });

    return res.json(updated);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

export default router;
