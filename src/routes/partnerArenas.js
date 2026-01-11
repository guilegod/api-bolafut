import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

const createSchema = z.object({
  organizerId: z.string().min(1),
  courtId: z.string().min(1),
});

// ✅ POST /partner-arenas
// arena_owner cria parceria: organizador X pode usar courtId (desde que a court seja dele)
// admin pode criar qualquer
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const data = createSchema.parse(req.body);

    const court = await prisma.court.findUnique({ where: { id: data.courtId } });
    if (!court) return res.status(404).json({ message: "Arena não encontrada" });

    if (isRole(user, ["arena_owner"]) && court.arenaOwnerId !== user.id) {
      return res.status(403).json({ message: "Você não pode liberar uma arena que não é sua" });
    }

    // garante que organizer existe
    const organizer = await prisma.user.findUnique({ where: { id: data.organizerId } });
    if (!organizer) return res.status(404).json({ message: "Organizador não encontrado" });

    if (!["owner", "admin"].includes(organizer.role)) {
      return res.status(400).json({ message: "Este usuário não é organizador" });
    }

    const partnership = await prisma.partnerArena.create({
      data: {
        organizerId: data.organizerId,
        courtId: data.courtId,
      },
      include: { court: true, organizer: { select: { id: true, name: true, email: true, role: true } } },
    });

    return res.status(201).json(partnership);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

// ✅ GET /partner-arenas
// arena_owner: lista parcerias das courts dele
// owner: lista as parcerias dele
// admin: lista tudo
router.get("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (isRole(user, ["admin"])) {
      const list = await prisma.partnerArena.findMany({
        include: { court: true, organizer: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      });
      return res.json(list);
    }

    if (isRole(user, ["arena_owner"])) {
      const list = await prisma.partnerArena.findMany({
        where: { court: { arenaOwnerId: user.id } },
        include: { court: true, organizer: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      });
      return res.json(list);
    }

    if (isRole(user, ["owner"])) {
      const list = await prisma.partnerArena.findMany({
        where: { organizerId: user.id },
        include: { court: true },
        orderBy: { createdAt: "desc" },
      });
      return res.json(list);
    }

    return res.json([]);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar parcerias", error: String(e) });
  }
});

// ✅ DELETE /partner-arenas/:id
// arena_owner pode remover se a court é dele
// admin pode tudo
router.delete("/:id", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const id = req.params.id;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const partnership = await prisma.partnerArena.findUnique({
      where: { id },
      include: { court: true },
    });

    if (!partnership) return res.status(404).json({ message: "Parceria não encontrada" });

    if (isRole(user, ["arena_owner"]) && partnership.court?.arenaOwnerId !== user.id) {
      return res.status(403).json({ message: "Você não pode remover essa parceria" });
    }

    await prisma.partnerArena.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Erro ao remover parceria", error: String(e) });
  }
});

export default router;
