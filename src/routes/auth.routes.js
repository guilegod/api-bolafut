import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../utils/jwt.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

// =======================
// REGISTER
// =======================
const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["user", "owner", "admin"]).optional(),
});

router.post("/register", async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);

    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) return res.status(409).json({ message: "Email já cadastrado" });

    const hash = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hash,
        role: data.role ?? "user",
      },
      select: { id: true, name: true, email: true, role: true },
    });

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    return res.status(201).json({ user, token });
  } catch (e) {
    // Se for ZodError, e.issues existe e ajuda MUITO no debug
    return res.status(400).json({
      message: "Dados inválidos",
      error: e?.issues ?? String(e),
    });
  }
});

// =======================
// LOGIN
// =======================
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) return res.status(401).json({ message: "Credenciais inválidas" });

    const ok = await bcrypt.compare(data.password, user.password);
    if (!ok) return res.status(401).json({ message: "Credenciais inválidas" });

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    return res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (e) {
    return res.status(400).json({
      message: "Dados inválidos",
      error: e?.issues ?? String(e),
    });
  }
});

// =======================
// ME (token -> user)
// =======================
router.get("/me", authRequired, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    if (!user) return res.status(404).json({ message: "Usuário não encontrado" });

    return res.json({ user });
  } catch {
    return res.status(500).json({ message: "Erro ao buscar usuário" });
  }
});

export default router;
