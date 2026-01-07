import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

router.get("/", async (req, res) => {
  const matches = await prisma.match.findMany({
    include: { court: true },
    orderBy: { date: "asc" },
  });
  res.json(matches);
});

const matchSchema = z.object({
  title: z.string().min(2),
  date: z.string(),      // ISO string
  courtId: z.string(),
});

router.post("/", authRequired, async (req, res) => {
  try {
    const data = matchSchema.parse(req.body);

    const match = await prisma.match.create({
      data: {
        title: data.title,
        date: new Date(data.date),
        courtId: data.courtId,
        organizerId: req.user.id,
      },
      include: { court: true },
    });

    res.status(201).json(match);
  } catch (e) {
    res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

export default router;
