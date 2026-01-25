import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

const createSchema = z.object({
  courtId: z.string().min(5),
  startAt: z.string().min(10), // ISO string
  durationMinutes: z.number().int().min(30).max(24 * 60).optional(), // padrão 60
  notes: z.string().max(500).optional().nullable(),
});

// helpers
function addMinutes(date, minutes) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  // overlap: A começa antes de B terminar e A termina depois de B começar
  return aStart < bEnd && aEnd > bStart;
}

function ymdToRange(dateYMD) {
  // dateYMD: "2026-01-25"
  const start = new Date(`${dateYMD}T00:00:00.000Z`);
  const end = new Date(`${dateYMD}T23:59:59.999Z`);
  return { start, end };
}

async function isArenaOwnerOfCourt(userId, courtId) {
  const court = await prisma.court.findUnique({
    where: { id: courtId },
    select: {
      arenaOwnerId: true, // legado
      arena: { select: { ownerId: true } }, // novo
    },
  });

  if (!court) return false;

  const legacyOk = court.arenaOwnerId && court.arenaOwnerId === userId;
  const newOk = court.arena?.ownerId && court.arena.ownerId === userId;

  return Boolean(legacyOk || newOk);
}

// ======================================================
// POST /reservations
// - Cria reserva (padrão 60min)
// - Bloqueia conflito com:
//   - Reservation (mesma quadra)
//   - Match (mesma quadra) assumindo match = 60min
// ======================================================
router.post("/", authRequired, async (req, res) => {
  try {
    const user = req.user;
    const data = createSchema.parse(req.body);

    const startAt = new Date(data.startAt);
    if (!isValidDate(startAt)) {
      return res.status(400).json({ message: "startAt inválido" });
    }

    const duration = Number(data.durationMinutes || 60);
    const endAt = addMinutes(startAt, duration);

    // court existe?
    const court = await prisma.court.findUnique({
      where: { id: data.courtId },
      select: { id: true, pricePerHour: true },
    });
    if (!court) return res.status(404).json({ message: "Quadra não encontrada" });

    // totalPrice (opcional): baseado em pricePerHour
    let totalPrice = null;
    if (typeof court.pricePerHour === "number" && court.pricePerHour >= 0) {
      totalPrice = Math.round((court.pricePerHour * duration) / 60);
    }

    // 1) conflito com outras reservas (não canceladas)
    const conflictReservation = await prisma.reservation.findFirst({
      where: {
        courtId: data.courtId,
        status: { not: "CANCELED" },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true, startAt: true, endAt: true, status: true },
    });

    if (conflictReservation) {
      return res.status(409).json({
        message: "Horário já reservado",
        conflict: { type: "reservation", ...conflictReservation },
      });
    }

    // 2) conflito com Match (assumindo 60min por match)
    // pega matches numa janela ampliada pra filtrar em JS
    const windowStart = addMinutes(startAt, -180);
    const windowEnd = addMinutes(endAt, 180);

    const matches = await prisma.match.findMany({
      where: {
        courtId: data.courtId,
        date: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, date: true, title: true },
    });

    const conflictMatch = matches.find((m) => {
      const mStart = new Date(m.date);
      const mEnd = addMinutes(mStart, 60);
      return overlaps(startAt, endAt, mStart, mEnd);
    });

    if (conflictMatch) {
      return res.status(409).json({
        message: "Horário já ocupado por uma partida",
        conflict: {
          type: "match",
          id: conflictMatch.id,
          date: conflictMatch.date,
          title: conflictMatch.title,
        },
      });
    }

    const created = await prisma.reservation.create({
      data: {
        courtId: data.courtId,
        userId: user.id,
        startAt,
        endAt,
        totalPrice,
        status: "PENDING",
        paymentStatus: "UNPAID",
        notes: (data.notes || "").toString().trim() || null,
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        court: {
          select: {
            id: true,
            name: true,
            type: true,
            pricePerHour: true,
            arenaId: true,
            arena: { select: { id: true, name: true, ownerId: true } },
          },
        },
      },
    });

    return res.status(201).json(created);
  } catch (e) {
    return res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

// ======================================================
// GET /reservations?date=YYYY-MM-DD&arenaId=...&courtId=...
// - Para agenda (arena_owner)
// ======================================================
router.get("/", authRequired, async (req, res) => {
  try {
    const user = req.user;

    const date = String(req.query.date || "").trim(); // YYYY-MM-DD
    const arenaId = String(req.query.arenaId || "").trim();
    const courtId = String(req.query.courtId || "").trim();

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Informe date=YYYY-MM-DD" });
    }

    const { start, end } = ymdToRange(date);

    // filtro base de data
    const where = {
      startAt: { gte: start, lte: end },
    };

    // se veio courtId, filtra nele
    if (courtId) where.courtId = courtId;

    // se veio arenaId, filtra por arena via court
    if (arenaId) {
      where.court = { arenaId };
    }

    // controle de acesso:
    // - admin vê tudo
    // - arena_owner vê só reservas das quadras dele (legado) OU arenas dele (novo)
    // - owner pode ver (pra operar), mas se quiser restringir depois, dá.
    if (user.role === "arena_owner") {
      where.OR = [
        { court: { arenaOwnerId: user.id } }, // legado
        { court: { arena: { ownerId: user.id } } }, // novo
      ];
    }

    const list = await prisma.reservation.findMany({
      where,
      orderBy: { startAt: "asc" },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        court: {
          select: {
            id: true,
            name: true,
            type: true,
            arenaId: true,
            pricePerHour: true,
            arena: { select: { id: true, name: true, ownerId: true, address: true } },
          },
        },
      },
    });

    return res.json(list);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar reservas", error: String(e) });
  }
});

// ======================================================
// PATCH /reservations/:id/confirm
// PATCH /reservations/:id/pay
// PATCH /reservations/:id/cancel
// - Só arena_owner (da quadra) ou admin
// ======================================================
async function guardArenaOwnerOrAdmin(req, res, next) {
  try {
    const user = req.user;
    if (user.role === "admin") return next();

    const id = String(req.params.id || "").trim();
    const r = await prisma.reservation.findUnique({
      where: { id },
      select: { courtId: true },
    });
    if (!r) return res.status(404).json({ message: "Reserva não encontrada" });

    const ok = await isArenaOwnerOfCourt(user.id, r.courtId);
    if (!ok) return res.status(403).json({ message: "Sem permissão" });

    req._reservationCourtId = r.courtId;
    return next();
  } catch (e) {
    return res.status(500).json({ message: "Erro de permissão", error: String(e) });
  }
}

router.patch("/:id/confirm", authRequired, guardArenaOwnerOrAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "CONFIRMED" },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        court: { select: { id: true, name: true, type: true, arenaId: true } },
      },
    });
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao confirmar reserva", error: String(e) });
  }
});

router.patch("/:id/pay", authRequired, guardArenaOwnerOrAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const updated = await prisma.reservation.update({
      where: { id },
      data: { paymentStatus: "PAID" },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        court: { select: { id: true, name: true, type: true, arenaId: true } },
      },
    });
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao marcar como pago", error: String(e) });
  }
});

router.patch("/:id/cancel", authRequired, guardArenaOwnerOrAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "CANCELED" },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        court: { select: { id: true, name: true, type: true, arenaId: true } },
      },
    });
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao cancelar reserva", error: String(e) });
  }
});

export default router;
