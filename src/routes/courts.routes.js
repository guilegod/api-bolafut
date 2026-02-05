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

  // ✅ OBRIGATÓRIO (sem modo manual / sem quadra solta)
  arenaId: z.string().min(5),
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

  // ✅ permitir mover de arena? (deixei permitido, mas com validação de dono)
  arenaId: z.string().min(5).optional(),
});

const includeFull = {
  arenaOwner: { select: { id: true, name: true, email: true, role: true } }, // legado (se existir no schema)
  arena: { select: { id: true, name: true, city: true, district: true, address: true, imageUrl: true, ownerId: true } },
};

async function assertArenaOwnershipOrAdmin(user, arenaId) {
  const arena = await prisma.arena.findUnique({ where: { id: arenaId } });
  if (!arena) return { ok: false, status: 400, message: "Dados inválidos", error: "arenaId não existe" };

  if (user?.role === "admin") return { ok: true, arena };

  if (user?.role === "arena_owner" && arena.ownerId === user.id) return { ok: true, arena };

  return { ok: false, status: 403, message: "Você só pode gerenciar quadras das suas arenas" };
}

// ======================================================
// ✅ GET /courts/mine — quadras das minhas arenas (arena_owner/admin)
// ======================================================
router.get("/mine", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const where =
      user.role === "admin"
        ? {}
        : {
            OR: [
              // ✅ novo (preferência)
              { arena: { ownerId: user.id } },
              // ✅ legado (pra não quebrar histórico enquanto migra)
              { arenaOwnerId: user.id },
            ],
          };

    const courts = await prisma.court.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: includeFull,
    });

    return res.json(courts);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar suas quadras", error: String(e) });
  }
});

// ======================================================
// ✅ GET /courts — (auth) lista geral (se você usa isso na home/admin)
// ======================================================
router.get("/", authRequired, async (req, res) => {
  try {
    const courts = await prisma.court.findMany({
      orderBy: { createdAt: "desc" },
      include: includeFull,
    });
    return res.json(courts);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar quadras", error: String(e) });
  }
});

// ======================================================
// ✅ POST /courts — cria quadra (arena_owner/admin)
// ======================================================
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = courtCreateSchema.parse(req.body);
    const arenaId = String(data.arenaId).trim();

    const check = await assertArenaOwnershipOrAdmin(user, arenaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message, error: check.error });

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

        // ✅ obrigatório
        arenaId,

        // ✅ legado (opcional, se seu schema ainda tem)
        arenaOwnerId: user.role === "arena_owner" ? user.id : null,
      },
      include: includeFull,
    });

    return res.status(201).json(created);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

// ======================================================
// ✅ PATCH /courts/:id — editar quadra (arena_owner/admin)
// ======================================================
router.patch("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const id = String(req.params.id || "").trim();

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const court = await prisma.court.findUnique({
      where: { id },
      include: { arena: true },
    });
    if (!court) return res.status(404).json({ message: "Quadra não encontrada" });

    // ✅ permissão: admin ou dono da arena (novo) ou legado (enquanto migra)
    if (user.role !== "admin") {
      const newOk = court.arena?.ownerId === user.id;
      const legacyOk = court.arenaOwnerId === user.id;
      if (!newOk && !legacyOk) {
        return res.status(403).json({ message: "Você não pode editar uma quadra que não é sua" });
      }
    }

    const data = courtUpdateSchema.parse(req.body);

    // ✅ se quiser mover de arena, valida dono na nova arena
    if (data.arenaId !== undefined) {
      const nextArenaId = String(data.arenaId || "").trim();
      const check = await assertArenaOwnershipOrAdmin(user, nextArenaId);
      if (!check.ok) return res.status(check.status).json({ message: check.message, error: check.error });
    }

    const updated = await prisma.court.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.arenaId !== undefined ? { arenaId: String(data.arenaId).trim() } : {}),
      },
      include: includeFull,
    });

    return res.json(updated);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

// ======================================================
// ✅ DELETE /courts/:id — excluir quadra (arena_owner/admin)
// ======================================================
router.delete("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const id = String(req.params.id || "").trim();

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const court = await prisma.court.findUnique({
      where: { id },
      include: { arena: true },
    });
    if (!court) return res.status(404).json({ message: "Quadra não encontrada" });

    if (user.role !== "admin") {
      const newOk = court.arena?.ownerId === user.id;
      const legacyOk = court.arenaOwnerId === user.id;
      if (!newOk && !legacyOk) {
        return res.status(403).json({ message: "Você não pode excluir uma quadra que não é sua" });
      }
    }

    await prisma.court.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Erro ao excluir quadra", error: String(e) });
  }
});

export default router;
