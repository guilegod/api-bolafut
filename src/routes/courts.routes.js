import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

router.get("/", async (req, res) => {
  const courts = await prisma.court.findMany({ orderBy: { createdAt: "desc" } });
  res.json(courts);
});

const courtSchema = z.object({
  name: z.string().min(2),
  city: z.string().optional(),
  address: z.string().optional(),
});

router.post("/", authRequired, async (req, res) => {
  // se quiser travar só owner/admin:
  // if (!["owner","admin"].includes(req.user.role)) return res.status(403).json({message:"Sem permissão"});

  try {
    const data = courtSchema.parse(req.body);
    const court = await prisma.court.create({ data });
    res.status(201).json(court);
  } catch (e) {
    res.status(400).json({ message: "Dados inválidos", error: String(e) });
  }
});

export default router;
