import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 40);
}

const courtCreateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
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
    .default("FUTSAL"),
  city: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  arenaId: z.string().optional().nullable(),
});

const courtUpdateSchema = z.object({
  name: z.string().min(2).optional(),
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
    .optional(),
  city: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  arenaId: z.string().optional().nullable(),
});

const includeArenaOwner = {
  arenaOwner: { select: { id: true, name: true, email: true, role: true } },
  arena: { select: { id: true, name: true, city: true, district: true, address: true, imageUrl: true } },
};

router.get("/mine", authRequired, async (req, res) => {
  try {
    const user = req.user;
    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const where = isRole(user, ["admin"]) ? {} : { arenaOwnerId: user.id };
    const courts = await prisma.court.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: includeArenaOwner,
    });
    return res.json(courts);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar suas quadras", error: String(e) });
  }
});

router.get("/", authRequired, async (req, res) => {
  try {
    // 🔥 Home precisa listar TODAS as arenas/quadras para qualquer role.
    const courts = await prisma.court.findMany({
      orderBy: { createdAt: "desc" },
      include: includeArenaOwner,
    });
    return res.json(courts);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar arenas", error: String(e) });
  }
});

router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = courtCreateSchema.parse(req.body);

    let arenaId = data.arenaId ? String(data.arenaId).trim() : null;
    if (arenaId) {
      const arena = await prisma.arena.findUnique({ where: { id: arenaId } });
      if (!arena) return res.status(400).json({ message: "Dados inválidos", error: "arenaId não existe" });
      if (isRole(user, ["arena_owner"]) && arena.ownerId !== user.id) {
        return res.status(403).json({ message: "Você só pode criar quadras nas suas arenas" });
      }
    }

    const baseId = data.id?.trim()
      ? data.id.trim()
      : `${slugify(data.name)}-${String(data.type).toLowerCase()}-${Math.random().toString(16).slice(2, 6)}`;

    const created = await prisma.court.create({
      data: {
        id: baseId,
        name: data.name,
        type: data.type,
        city: data.city ?? null,
        address: data.address ?? null,
        arenaId,
        arenaOwnerId: isRole(user, ["arena_owner"]) ? user.id : null, // legado
      },
      include: includeArenaOwner,
    });

    return res.status(201).json(created);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

router.patch("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const id = req.params.id;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const court = await prisma.court.findUnique({ where: { id } });
    if (!court) return res.status(404).json({ message: "Quadra não encontrada" });

    if (isRole(user, ["arena_owner"]) && court.arenaOwnerId !== user.id) {
      return res.status(403).json({ message: "Você não pode editar uma quadra que não é sua" });
    }

    const data = courtUpdateSchema.parse(req.body);

    if (data.arenaId !== undefined) {
      const nextArenaId = data.arenaId ? String(data.arenaId).trim() : null;
      if (nextArenaId) {
        const arena = await prisma.arena.findUnique({ where: { id: nextArenaId } });
        if (!arena) return res.status(400).json({ message: "Dados inválidos", error: "arenaId não existe" });
        if (isRole(user, ["arena_owner"]) && arena.ownerId !== user.id) {
          return res.status(403).json({ message: "Você só pode mover quadra para suas arenas" });
        }
      }
    }

    const updated = await prisma.court.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.arenaId !== undefined ? { arenaId: data.arenaId ? String(data.arenaId).trim() : null } : {}),
      },
      include: includeArenaOwner,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

router.delete("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const id = req.params.id;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const court = await prisma.court.findUnique({ where: { id } });
    if (!court) return res.status(404).json({ message: "Quadra não encontrada" });

    if (isRole(user, ["arena_owner"]) && court.arenaOwnerId !== user.id) {
      return res.status(403).json({ message: "Você não pode excluir uma quadra que não é sua" });
    }

    await prisma.court.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Erro ao excluir quadra", error: String(e) });
  }
});

export default router;
