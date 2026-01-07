import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch {
    res.status(500).json({ ok: false, db: false });
  }
});

export default router;
