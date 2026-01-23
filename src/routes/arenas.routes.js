import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import { uploadArenaImageBase64 } from "../lib/uploadArenaImage.js";

const router = Router();

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

const arenaCreateSchema = z.object({
  name: z.string().min(2),
  city: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  openTime: z.string().optional().nullable(),  // "09:00"
  closeTime: z.string().optional().nullable(), // "23:00"
  imageBase64: z.string().optional().nullable(), // data:image/... base64
});

const arenaUpdateSchema = arenaCreateSchema.partial();

// ✅ GET /arenas — público (pra feed/home)
router.get("/", async (req, res) => {
  try {
    const arenas = await prisma.arena.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true } },
        courts: { select: { id: true, name: true, type: true, city: true, address: true } },
      },
    });

    return res.json(
      arenas.map((a) => ({
        ...a,
        courtsCount: a.courts?.length || 0,
      }))
    );
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar arenas", error: String(e) });
  }
});

// ✅ GET /arenas/:id — público
router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const arena = await prisma.arena.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true } },
        courts: { select: { id: true, name: true, type: true, city: true, address: true } },
      },
    });
    if (!arena) return res.status(404).json({ message: "Arena não encontrada" });
    return res.json({ ...arena, courtsCount: arena.courts?.length || 0 });
  } catch (e) {
    return res.status(500).json({ message: "Erro ao buscar arena", error: String(e) });
  }
});

// ✅ POST /arenas — somente arena_owner/admin
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = arenaCreateSchema.parse(req.body);

    const created = await prisma.arena.create({
      data: {
        name: data.name,
        city: data.city ?? null,
        district: data.district ?? null,
        address: data.address ?? null,
        openTime: data.openTime ?? null,
        closeTime: data.closeTime ?? null,
        ownerId: user.id,
      },
    });

    // ✅ upload foto (opcional)
    let imageUrl = null;
    if (data.imageBase64) {
      imageUrl = await uploadArenaImageBase64({
        arenaId: created.id,
        base64: data.imageBase64,
      });
      await prisma.arena.update({ where: { id: created.id }, data: { imageUrl } });
    }

    const arena = await prisma.arena.findUnique({
      where: { id: created.id },
      include: { courts: true, owner: { select: { id: true, name: true } } },
    });

    return res.status(201).json(arena);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

// ✅ PATCH /arenas/:id — dono/admin
router.patch("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const id = String(req.params.id);

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const arena = await prisma.arena.findUnique({ where: { id } });
    if (!arena) return res.status(404).json({ message: "Arena não encontrada" });

    if (isRole(user, ["arena_owner"]) && arena.ownerId !== user.id) {
      return res.status(403).json({ message: "Você não pode editar uma arena que não é sua" });
    }

    const data = arenaUpdateSchema.parse(req.body);

    let nextImageUrl = arena.imageUrl;
    if (data.imageBase64) {
      nextImageUrl = await uploadArenaImageBase64({ arenaId: id, base64: data.imageBase64 });
    }

    const updated = await prisma.arena.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.district !== undefined ? { district: data.district } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.openTime !== undefined ? { openTime: data.openTime } : {}),
        ...(data.closeTime !== undefined ? { closeTime: data.closeTime } : {}),
        ...(data.imageBase64 ? { imageUrl: nextImageUrl } : {}),
      },
      include: {
        owner: { select: { id: true, name: true } },
        courts: true,
      },
    });

    return res.json(updated);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

export default router;
