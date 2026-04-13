import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

const createPeladaLocationSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().min(2).max(220),
});

const updatePeladaLocationSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  address: z.string().min(2).max(220).optional(),
  isActive: z.boolean().optional(),
});

/* ======================================================
   GET /pelada-locations/public
   Lista locais ativos para o select do front
   ====================================================== */

router.get("/public", async (req, res) => {
  try {
    const locations = await prisma.peladaLocation.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        address: true,
        isActive: true,
      },
    });

    return res.json(locations);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao listar locais públicos",
      error: String(e),
    });
  }
});

/* ======================================================
   GET /pelada-locations
   Lista locais do painel
   - admin vê todos
   - owner vê os que criou
   ====================================================== */

router.get("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["admin", "owner"])) {
      return res.status(403).json({
        message: "Sem permissão para listar locais",
      });
    }

    const where =
      user.role === "admin"
        ? {}
        : {
            createdById: user.id,
          };

    const locations = await prisma.peladaLocation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        _count: {
          select: {
            matches: true,
          },
        },
      },
    });

    return res.json(locations);
  } catch (e) {
    return res.status(500).json({
      message: "Erro ao listar locais",
      error: String(e),
    });
  }
});

/* ======================================================
   POST /pelada-locations
   Cria novo local cadastrado
   - owner e admin
   ====================================================== */

router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    if (!isRole(user, ["admin", "owner"])) {
      return res.status(403).json({
        message: "Sem permissão para criar local",
      });
    }

    const data = createPeladaLocationSchema.parse(req.body);

    const exists = await prisma.peladaLocation.findFirst({
      where: {
        name: data.name.trim(),
        address: data.address.trim(),
      },
      select: { id: true },
    });

    if (exists) {
      return res.status(409).json({
        message: "Já existe um local com esse nome e endereço",
      });
    }

    const created = await prisma.peladaLocation.create({
      data: {
        name: data.name.trim(),
        address: data.address.trim(),
        isActive: true,
        createdById: user.id,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });

    return res.status(201).json(created);
  } catch (e) {
    return res.status(400).json({
      message: "Erro ao criar local",
      error: String(e),
    });
  }
});

/* ======================================================
   PATCH /pelada-locations/:id
   Edita local
   - admin edita qualquer um
   - owner só edita os que criou
   ====================================================== */

router.patch("/:id([a-z0-9]{20,})", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const id = String(req.params.id || "").trim();

    if (!isRole(user, ["admin", "owner"])) {
      return res.status(403).json({
        message: "Sem permissão para editar local",
      });
    }

    const data = updatePeladaLocationSchema.parse(req.body);

    const existing = await prisma.peladaLocation.findUnique({
      where: { id },
      select: {
        id: true,
        createdById: true,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Local não encontrado",
      });
    }

    if (user.role !== "admin" && existing.createdById !== user.id) {
      return res.status(403).json({
        message: "Você só pode editar os locais que criou",
      });
    }

    const updated = await prisma.peladaLocation.update({
      where: { id },
      data: {
        ...(typeof data.name === "string" ? { name: data.name.trim() } : {}),
        ...(typeof data.address === "string"
          ? { address: data.address.trim() }
          : {}),
        ...(typeof data.isActive === "boolean"
          ? { isActive: data.isActive }
          : {}),
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        _count: {
          select: {
            matches: true,
          },
        },
      },
    });

    return res.json(updated);
  } catch (e) {
    return res.status(400).json({
      message: "Erro ao atualizar local",
      error: String(e),
    });
  }
});

/* ======================================================
   PATCH /pelada-locations/:id/toggle
   Ativa/desativa local
   - admin pode tudo
   - owner só nos que criou
   ====================================================== */

router.patch("/:id([a-z0-9]{20,})/toggle", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const id = String(req.params.id || "").trim();

    if (!isRole(user, ["admin", "owner"])) {
      return res.status(403).json({
        message: "Sem permissão para alterar status do local",
      });
    }

    const existing = await prisma.peladaLocation.findUnique({
      where: { id },
      select: {
        id: true,
        isActive: true,
        createdById: true,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Local não encontrado",
      });
    }

    if (user.role !== "admin" && existing.createdById !== user.id) {
      return res.status(403).json({
        message: "Você só pode alterar os locais que criou",
      });
    }

    const updated = await prisma.peladaLocation.update({
      where: { id },
      data: {
        isActive: !existing.isActive,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        _count: {
          select: {
            matches: true,
          },
        },
      },
    });

    return res.json(updated);
  } catch (e) {
    return res.status(400).json({
      message: "Erro ao alterar status do local",
      error: String(e),
    });
  }
});

export default router;