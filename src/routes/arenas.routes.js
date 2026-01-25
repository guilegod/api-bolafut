import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import { uploadArenaImageBase64 } from "../lib/uploadArenaImage.js";

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
    .slice(0, 50);
}

const arenaCreateSchema = z.object({
  name: z.string().min(2),
  city: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  openTime: z.string().optional().nullable(), // "09:00"
  closeTime: z.string().optional().nullable(), // "23:00"
  imageBase64: z.string().optional().nullable(), // data:image/... base64
});

const arenaUpdateSchema = arenaCreateSchema.partial();

// ======================================================
// ✅ GET /arenas — público (pra feed/home)
// ======================================================
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

// ======================================================
// ✅ GET /arenas/mine — auth (dono/admin)
// IMPORTANTE: precisa vir ANTES do "/:id"
// ======================================================
router.get("/mine", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const where = user.role === "admin" ? {} : { ownerId: user.id };

    const arenas = await prisma.arena.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true } },
        courts: { select: { id: true, name: true, type: true, city: true, address: true } },
      },
    });

    // Se você quiser só 1 arena por conta, devolve arenas[0] no front.
    return res.json(
      arenas.map((a) => ({
        ...a,
        courtsCount: a.courts?.length || 0,
      }))
    );
  } catch (e) {
    return res.status(500).json({ message: "Erro ao carregar sua arena", error: String(e) });
  }
});

// ======================================================
// ✅ GET /arenas/slug/:slug — público (perfil bonito por slug)
// (opcional, mas recomendo)
// ======================================================
router.get("/slug/:slug", async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const arena = await prisma.arena.findFirst({
      where: { slug },
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

// ======================================================
// ✅ GET /arenas/:id — público (por id)
// ======================================================
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

// ======================================================
// ✅ POST /arenas — somente arena_owner/admin
// ======================================================
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = arenaCreateSchema.parse(req.body);

    // slug único (se teu schema tiver `slug String @unique`)
    const baseSlug = slugify(data.name);
    const slug = `${baseSlug}-${Math.random().toString(16).slice(2, 6)}`;

    const created = await prisma.arena.create({
      data: {
        name: data.name,
        slug, // ✅ (se teu schema não tiver slug, remove essa linha)
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

// ======================================================
// ✅ PATCH /arenas/:id — dono/admin
// ======================================================
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
        // slug opcional: se renomeou, dá pra manter slug antigo pra não quebrar link
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
