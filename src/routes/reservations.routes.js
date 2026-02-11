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

/* =========================================================
   ✅ PUBLIC: slots de agenda por arena/slug (sem auth)
   GET /reservations/public/slots?slug=...&date=YYYY-MM-DD
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

    // Se vier inválido, devolve vazio (não quebra)
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
        status: { notIn: ["CANCELED", "CANCELLED"] },
        OR: [
          // sobrepõe o dia
          { startAt: { lte: dayEnd }, endAt: { gte: dayStart } },
        ],
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

    // 2) Matches tipo BOOKING que bloqueiam (se você usa isso como “reserva”)
    const matches = await prisma.match.findMany({
      where: {
        courtId: { in: courtIds },
        kind: "BOOKING",
        status: { notIn: ["CANCELED", "EXPIRED", "FINISHED"] },
        date: { gte: dayStart, lte: dayEnd },
      },
      select: {
        id: true,
        courtId: true,
        date: true,
        status: true,
      },
    });

    // Converte matches em blocos (1h por padrão)
    const matchBlocks = matches.map((m) => {
      const startAt = m.date;
      const endAt = addMinutesToBaseDate(m.date, slotMinutes);
      return { id: m.id, courtId: m.courtId, startAt, endAt, status: m.status };
    });

    const blocksByCourt = new Map();
    for (const r of reservations) {
      if (!blocksByCourt.has(r.courtId)) blocksByCourt.set(r.courtId, []);
      blocksByCourt.get(r.courtId).push({
        startAt: r.startAt,
        endAt: r.endAt,
        status: r.status,
        totalPrice: r.totalPrice ?? null,
      });
    }
    for (const b of matchBlocks) {
      if (!blocksByCourt.has(b.courtId)) blocksByCourt.set(b.courtId, []);
      blocksByCourt.get(b.courtId).push({
        startAt: b.startAt,
        endAt: b.endAt,
        status: b.status,
        totalPrice: null,
      });
    }

    // Monta slots
    const out = {};
    for (const c of courts) {
      const blocks = blocksByCourt.get(c.id) || [];
      const slots = [];

      for (let t = openMin; t + slotMinutes <= closeMin; t += slotMinutes) {
        const startAt = addMinutesToBaseDate(dayBase, t);
        const endAt = addMinutesToBaseDate(dayBase, t + slotMinutes);

        const busy = blocks.some((b) => overlap(startAt, endAt, b.startAt, b.endAt));

        slots.push({
          start: toHM(startAt),
          end: toHM(endAt),
          status: busy ? "busy" : "free",
          price: Number.isFinite(Number(c.pricePerHour)) ? Number(c.pricePerHour) : null,
        });
      }

      out[c.id] = slots;
    }

    return res.json({
      dateLabel: date,
      courts: out,
    });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "Erro" });
  }
});

/* =========================================================
   🔒 AUTH (mantém como você já tinha)
   ========================================================= */
router.use(authRequired);

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
        OR: [
          { startAt: { lt: end }, endAt: { gt: start } }, // overlap
        ],
      },
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

/**
 * PATCH /reservations/:id/cancel
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
