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
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}

function makeSlugFromName(name) {
  const base = slugify(name);
  const rnd = Math.random().toString(16).slice(2, 6);
  return `${base}-${rnd}`;
}

const arenaCreateSchema = z.object({
  name: z.string().min(2),
  city: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  openTime: z.string().optional().nullable(),  // "09:00"
  closeTime: z.string().optional().nullable(), // "23:00"
  imageBase64: z.string().optional().nullable(), // data:image/...;base64,...
});

const arenaUpdateSchema = arenaCreateSchema.partial();

// ✅ include padrão (perfil público TOP)
const arenaInclude = {
  owner: { select: { id: true, name: true } },
  courts: {
    select: {
      id: true,
      name: true,
      type: true,
      city: true,
      address: true,
      pricePerHour: true,
      capacity: true,
      covered: true,
      surface: true,
      arenaId: true,
    },
    // Mais seguro que createdAt (caso Court não tenha createdAt)
    orderBy: { name: "asc" },
  },
};

// ======================================================
// ✅ GET /arenas — público (home/feed)
// ======================================================
router.get("/", async (req, res) => {
  try {
    const arenas = await prisma.arena.findMany({
      orderBy: { createdAt: "desc" },
      include: arenaInclude,
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
// ✅ GET /arenas/mine — auth (arena_owner/admin)
// IMPORTANTE: antes do "/:id"
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
      include: arenaInclude,
    });

    return res.json(
      arenas.map((a) => ({
        ...a,
        courtsCount: a.courts?.length || 0,
      }))
    );
  } catch (e) {
    return res.status(500).json({ message: "Erro ao carregar suas arenas", error: String(e) });
  }
});

// ======================================================
// ✅ GET /arenas/slug/:slug — público (perfil por slug)
// ✅ CORRIGIDO: tenta slug raw + slugify(raw) e insensitive
// ======================================================
router.get("/slug/:slug", async (req, res) => {
  try {
    const slugRaw = String(req.params.slug || "").trim();
    const slugNorm = slugify(slugRaw);

    const arena = await prisma.arena.findFirst({
      where: {
        OR: [
          { slug: slugRaw },
          { slug: slugNorm },
          { slug: { equals: slugRaw, mode: "insensitive" } },
          { slug: { equals: slugNorm, mode: "insensitive" } },
        ],
      },
      include: arenaInclude,
    });

    if (!arena) return res.status(404).json({ message: "Arena não encontrada", slug: slugRaw });

    return res.json({ ...arena, courtsCount: arena.courts?.length || 0 });
  } catch (e) {
    return res.status(500).json({ message: "Erro ao buscar arena", error: String(e) });
  }
});

// ======================================================
// ✅ POST /arenas/setup — cria 1ª arena pro dono (se não existir)
// ======================================================
router.post("/setup", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const existing = await prisma.arena.findFirst({
      where: { ownerId: user.id },
      include: arenaInclude,
    });

    if (existing) {
      return res.json({ ...existing, courtsCount: existing.courts?.length || 0 });
    }

    const baseName = (req.body?.name || `Arena de ${user.name || "Dono"}`).toString();
    const slug = makeSlugFromName(baseName);

    const created = await prisma.arena.create({
      data: {
        name: baseName,
        slug,
        city: req.body?.city ?? null,
        district: req.body?.district ?? null,
        address: req.body?.address ?? null,
        openTime: req.body?.openTime ?? null,
        closeTime: req.body?.closeTime ?? null,
        ownerId: user.id,
      },
      include: arenaInclude,
    });

    return res.status(201).json({ ...created, courtsCount: created.courts?.length || 0 });
  } catch (e) {
    return res.status(500).json({ message: "Erro no setup da arena", error: String(e) });
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
      include: arenaInclude,
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
    const slug = makeSlugFromName(data.name);

    const created = await prisma.arena.create({
      data: {
        name: data.name,
        slug,
        city: data.city ?? null,
        district: data.district ?? null,
        address: data.address ?? null,
        openTime: data.openTime ?? null,
        closeTime: data.closeTime ?? null,
        ownerId: user.id,
      },
    });

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
      include: arenaInclude,
    });

    return res.status(201).json({ ...arena, courtsCount: arena?.courts?.length || 0 });
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

    // se mudar nome, muda slug (novo) pra evitar colisão
    const nextSlug =
      data.name && data.name.trim()
        ? makeSlugFromName(data.name)
        : arena.slug;

    let nextImageUrl = arena.imageUrl;
    if (data.imageBase64) {
      nextImageUrl = await uploadArenaImageBase64({ arenaId: id, base64: data.imageBase64 });
    }

    const updated = await prisma.arena.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name, slug: nextSlug } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.district !== undefined ? { district: data.district } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.openTime !== undefined ? { openTime: data.openTime } : {}),
        ...(data.closeTime !== undefined ? { closeTime: data.closeTime } : {}),
        ...(data.imageBase64 ? { imageUrl: nextImageUrl } : {}),
      },
      include: arenaInclude,
    });

    return res.json({ ...updated, courtsCount: updated.courts?.length || 0 });
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

export default router;
