// reservations.routes.js
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

/* =========================================================
   Helpers (sem libs)
   ========================================================= */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function isValidISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function parseHM(hm) {
  const m = String(hm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function addMinutesToBaseDate(baseDate, minutes) {
  const d = new Date(baseDate);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function toHM(date) {
  const d = new Date(date);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function overlap(aStart, aEnd, bStart, bEnd) {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  return as < be && bs < ae;
}

function isRole(user, roles = []) {
  return roles.includes(user?.role);
}

/* =========================================================
   ✅ PUBLIC: slots de agenda por arena/slug (sem auth)
   GET /reservations/public/slots?slug=...&date=YYYY-MM-DD
   - Bloqueia por:
     - Reservation (status != CANCELED)
     - Match (BOOKING e PELADA) ativos no dia
   - Retorna "busyMeta" para o front conseguir exibir:
     "Ocupado por pelada" / "Ocupado por reserva"
   ========================================================= */
router.get("/public/slots", async (req, res) => {
  try {
    const schema = z.object({
      slug: z.string().min(2),
      date: z.string().refine(isValidISODate, "date deve ser YYYY-MM-DD"),
      slotMinutes: z
        .string()
        .optional()
        .transform((v) => (v ? Number(v) : 60))
        .refine((n) => Number.isFinite(n) && n >= 30 && n <= 180, "slotMinutes inválido"),
    });

    const { slug, date, slotMinutes } = schema.parse(req.query);

    const arena = await prisma.arena.findUnique({
      where: { slug },
      include: { courts: true },
    });

    if (!arena) return res.status(404).json({ error: "Arena não encontrada" });

    const courts = arena.courts || [];
    if (!courts.length) {
      return res.json({ dateLabel: date, courts: {} });
    }

    // Horário da arena (fallback padrão)
    const openHM = arena.openTime || "07:00";
    const closeHM = arena.closeTime || "23:00";

    const openMin = parseHM(openHM);
    const closeMinRaw = parseHM(closeHM);

    if (openMin == null || closeMinRaw == null) {
      return res.json({ dateLabel: date, courts: {} });
    }

    // Se fecha depois da meia noite (ex: 00:40), trata como +24h
    let closeMin = closeMinRaw;
    if (closeMin <= openMin) closeMin += 24 * 60;

    // Base do dia (local)
    const dayBase = new Date(`${date}T00:00:00`);
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);

    const courtIds = courts.map((c) => c.id);

    // 1) Reservas que bloqueiam (não canceladas)
    const reservations = await prisma.reservation.findMany({
      where: {
        courtId: { in: courtIds },
        status: { not: "CANCELED" },
        OR: [{ startAt: { lte: dayEnd }, endAt: { gte: dayStart } }],
      },
      select: {
        id: true,
        courtId: true,
        startAt: true,
        endAt: true,
        status: true,
        totalPrice: true,
      },
    });

    // 2) Matches que bloqueiam (BOOKING e PELADA)
    const matches = await prisma.match.findMany({
      where: {
        courtId: { in: courtIds },
        kind: { in: ["BOOKING", "PELADA"] },
        status: { notIn: ["CANCELED", "EXPIRED", "FINISHED"] },
        date: { gte: dayStart, lte: dayEnd },
      },
      select: {
        id: true,
        courtId: true,
        date: true,
        status: true,
        kind: true,
        title: true,
        maxPlayers: true,
        pricePerPlayer: true,
      },
    });

    // Converte matches em blocos (duração = slotMinutes)
    const matchBlocks = matches.map((m) => {
      const startAt = m.date;
      const endAt = addMinutesToBaseDate(m.date, slotMinutes);
      return {
        id: m.id,
        courtId: m.courtId,
        startAt,
        endAt,
        status: m.status,
        kind: m.kind,
        title: m.title || (m.kind === "PELADA" ? "Pelada" : "Reserva"),
        maxPlayers: m.maxPlayers ?? null,
        pricePerPlayer: m.pricePerPlayer ?? null,
      };
    });

    // blocksByCourt: courtId -> [blocks]
    const blocksByCourt = new Map();

    for (const r of reservations) {
      if (!blocksByCourt.has(r.courtId)) blocksByCourt.set(r.courtId, []);
      blocksByCourt.get(r.courtId).push({
        startAt: r.startAt,
        endAt: r.endAt,
        status: r.status,
        totalPrice: r.totalPrice ?? null,
        source: "reservation",
        reservationId: r.id,
        kind: null,
        title: "Reserva",
      });
    }

    for (const b of matchBlocks) {
      if (!blocksByCourt.has(b.courtId)) blocksByCourt.set(b.courtId, []);
      blocksByCourt.get(b.courtId).push({
        startAt: b.startAt,
        endAt: b.endAt,
        status: b.status,
        totalPrice: null,
        source: "match",
        matchId: b.id,
        kind: b.kind, // PELADA | BOOKING
        title: b.title,
        maxPlayers: b.maxPlayers,
        pricePerPlayer: b.pricePerPlayer,
      });
    }

    const out = {};

    for (const c of courts) {
      const blocks = blocksByCourt.get(c.id) || [];
      const slots = [];

      for (let t = openMin; t + slotMinutes <= closeMin; t += slotMinutes) {
        const startAt = addMinutesToBaseDate(dayBase, t);
        const endAt = addMinutesToBaseDate(dayBase, t + slotMinutes);

        const busyBlock = blocks.find((b) => overlap(startAt, endAt, b.startAt, b.endAt));
        const busy = !!busyBlock;

        slots.push({
          start: toHM(startAt),
          end: toHM(endAt),
          status: busy ? "busy" : "free",
          price: Number.isFinite(Number(c.pricePerHour)) ? Number(c.pricePerHour) : null,

          // ✅ meta do bloqueio pro front mostrar "Pelada reservada"
          busyMeta: busy
            ? {
                source: busyBlock.source, // "reservation" | "match"
                kind: busyBlock.kind || null, // "PELADA" | "BOOKING" | null
                title: busyBlock.title || null,
                matchId: busyBlock.matchId || null,
                reservationId: busyBlock.reservationId || null,
                status: busyBlock.status || null,
                maxPlayers: busyBlock.maxPlayers ?? null,
                pricePerPlayer: busyBlock.pricePerPlayer ?? null,
              }
            : null,
        });
      }

      out[c.id] = slots;
    }

    return res.json({ dateLabel: date, courts: out });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "Erro" });
  }
});

/* =========================================================
   🔒 AUTH
   ========================================================= */
router.use(authRequired);

/* =========================================================
   ✅ DONO: listar reservas das MINHAS arenas (por data)
   GET /reservations/mine?date=YYYY-MM-DD
   ========================================================= */
router.get("/mine", async (req, res) => {
  try {
    const schema = z.object({
      date: z.string().refine(isValidISODate, "date deve ser YYYY-MM-DD"),
      status: z.enum(["PENDING", "CONFIRMED", "CANCELED"]).optional(),
    });

    const { date, status } = schema.parse(req.query);

    const user = req.user;

    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ error: "Apenas arena_owner/admin" });
    }

    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);

    const whereBase = {
      OR: [{ startAt: { lte: dayEnd }, endAt: { gte: dayStart } }],
      ...(status ? { status } : {}),
    };

    const where =
      user.role === "admin"
        ? whereBase
        : {
            ...whereBase,
            court: {
              arena: {
                ownerId: user.id,
              },
            },
          };

    const list = await prisma.reservation.findMany({
      where,
      orderBy: { startAt: "asc" },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        court: {
          select: {
            id: true,
            name: true,
            arenaId: true,
            arena: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    res.json(list);
  } catch (e) {
    res.status(400).json({ error: e?.message || "Erro" });
  }
});

/**
 * GET /reservations?courtId=...&date=YYYY-MM-DD
 */
router.get("/", async (req, res) => {
  try {
    const schema = z.object({
      courtId: z.string().min(10),
      date: z.string().refine(isValidISODate, "date deve ser YYYY-MM-DD"),
    });

    const { courtId, date } = schema.parse(req.query);

    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    const reservations = await prisma.reservation.findMany({
      where: {
        courtId,
        OR: [
          { startAt: { gte: start, lte: end } },
          { endAt: { gte: start, lte: end } },
          { startAt: { lte: start }, endAt: { gte: end } },
        ],
      },
      orderBy: { startAt: "asc" },
    });

    res.json(reservations);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * POST /reservations
 * body: { courtId, startAt, endAt, totalPrice?, notes? }
 */
router.post("/", async (req, res) => {
  try {
    const schema = z.object({
      courtId: z.string().min(10),
      startAt: z.string(),
      endAt: z.string(),
      totalPrice: z.number().int().optional(),
      notes: z.string().optional(),
    });

    const { courtId, startAt, endAt, totalPrice, notes } = schema.parse(req.body);

    const start = new Date(startAt);
    const end = new Date(endAt);

    if (!(start < end)) {
      return res.status(400).json({ error: "startAt deve ser antes de endAt" });
    }

    const userId = req.user.id;

    const conflict = await prisma.reservation.findFirst({
      where: {
        courtId,
        status: { not: "CANCELED" },
        OR: [{ startAt: { lt: end }, endAt: { gt: start } }],
      },
      select: { id: true, status: true },
    });

    if (conflict) {
      return res.status(409).json({ error: "Horário já reservado" });
    }

    const reservation = await prisma.reservation.create({
      data: {
        courtId,
        userId,
        startAt: start,
        endAt: end,
        totalPrice: totalPrice ?? null,
        notes: notes ?? null,
      },
    });

    res.json(reservation);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* =========================================================
   ✅ DONO: confirmar reserva (só PENDING)
   PATCH /reservations/:id/confirm
   ========================================================= */
router.patch("/:id/confirm", async (req, res) => {
  try {
    const { id } = req.params;

    const user = req.user;
    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ error: "Apenas arena_owner/admin" });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { court: { include: { arena: true } } },
    });

    if (!reservation) return res.status(404).json({ error: "Reserva não encontrada" });

    if (user.role !== "admin" && reservation.court?.arena?.ownerId !== user.id) {
      return res.status(403).json({ error: "Sem permissão" });
    }

    if (reservation.status !== "PENDING") {
      return res.status(409).json({ error: "Só é possível confirmar reservas PENDING" });
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "CONFIRMED" },
    });

    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e?.message || "Erro" });
  }
});

/* =========================================================
   ✅ DONO: marcar como pago (só CONFIRMED)
   PATCH /reservations/:id/paid
   ========================================================= */
router.patch("/:id/paid", async (req, res) => {
  try {
    const { id } = req.params;

    const user = req.user;
    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ error: "Apenas arena_owner/admin" });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { court: { include: { arena: true } } },
    });

    if (!reservation) return res.status(404).json({ error: "Reserva não encontrada" });

    if (user.role !== "admin" && reservation.court?.arena?.ownerId !== user.id) {
      return res.status(403).json({ error: "Sem permissão" });
    }

    if (reservation.status !== "CONFIRMED") {
      return res.status(409).json({ error: "Só pode marcar como pago quando estiver CONFIRMED" });
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: { paymentStatus: "PAID" },
    });

    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e?.message || "Erro" });
  }
});

/* =========================================================
   ✅ DONO: cancelar (PENDING/CONFIRMED)
   PATCH /reservations/:id/cancel-owner
   ========================================================= */
router.patch("/:id/cancel-owner", async (req, res) => {
  try {
    const { id } = req.params;

    const user = req.user;
    if (!isRole(user, ["arena_owner", "admin"])) {
      return res.status(403).json({ error: "Apenas arena_owner/admin" });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { court: { include: { arena: true } } },
    });

    if (!reservation) return res.status(404).json({ error: "Reserva não encontrada" });

    if (user.role !== "admin" && reservation.court?.arena?.ownerId !== user.id) {
      return res.status(403).json({ error: "Sem permissão" });
    }

    if (reservation.status === "CANCELED") {
      return res.status(409).json({ error: "Reserva já está cancelada" });
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "CANCELED" },
    });

    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e?.message || "Erro" });
  }
});

/**
 * PATCH /reservations/:id/cancel
 * (usuário cancela a própria reserva)
 */
router.patch("/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;

    const reservation = await prisma.reservation.findUnique({ where: { id } });
    if (!reservation) return res.status(404).json({ error: "Reserva não encontrada" });

    const userId = req.user.id;
    if (reservation.userId !== userId && req.user.role !== "admin") {
      return res.status(403).json({ error: "Sem permissão" });
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "CANCELED" },
    });

    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
