import express from "express";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

/**
 * GET /users/me/profile
 */
router.get("/me/profile", authRequired, async (req, res, next) => {
  try {
    const meId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: meId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        imageUrl: true,
        role: true,
        createdAt: true,
        profile: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
