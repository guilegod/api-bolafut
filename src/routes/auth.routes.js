import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../utils/jwt.js";
import { authRequired } from "../middleware/auth.js";
import crypto from "crypto";
import { makeMailer } from "../utils/mailer.js";

const router = Router();

// =======================
// REGISTER
// =======================
const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["user", "owner", "arena_owner", "admin"]).optional(),
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

// =======================
// FORGOT PASSWORD
// =======================
const forgotSchema = z.object({
  email: z.string().email(),
});

router.post("/forgot", async (req, res) => {
  try {
    const { email } = forgotSchema.parse(req.body);

    // ✅ sempre responder OK (não vaza se existe conta)
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true });

    // token "puro" para mandar no link
    const token = crypto.randomBytes(32).toString("hex");

    // salva só o hash no banco (mais seguro)
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const appUrl = process.env.APP_URL || "http://localhost:5173";
    const resetUrl = `${appUrl}/reset-password?token=${token}`;

    const { transporter, from, isReady } = makeMailer();

    // ✅ Se SMTP não estiver configurado, não derruba o fluxo
    if (!isReady) {
      console.warn("[forgot] SMTP não configurado — pulando envio de email");
      return res.json({ ok: true });
    }

    try {
      await transporter.sendMail({
        from, // ✅ já vem "BoraPô <suporte@borapo.com>" via env, ou o email puro
        to: user.email,
        subject: "BoraPô — Recuperação de senha",
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5">
            <h2>Recuperação de senha</h2>
            <p>Você pediu para redefinir sua senha no <b>BoraPô</b>.</p>
            <p>Clique no botão abaixo (válido por 30 minutos):</p>
            <p>
              <a href="${resetUrl}" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#2EDC8F;color:#061b12;text-decoration:none;font-weight:800">
                Redefinir senha
              </a>
            </p>
            <p>Se você não pediu isso, ignore este e-mail.</p>
          </div>
        `,
      });

      console.log("[forgot] email enviado para:", user.email);
    } catch (err) {
      console.error("[forgot] falha ao enviar email:", err);
      // ✅ não retorna 400, não trava fluxo
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(400).json({
      message: "Dados inválidos",
      error: e?.issues ?? String(e),
    });
  }
});

// =======================
// RESET PASSWORD
// =======================
const resetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(6),
});

router.post("/reset", async (req, res) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const row = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!row) return res.status(400).json({ message: "Token inválido." });
    if (row.usedAt) return res.status(400).json({ message: "Token já usado." });
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ message: "Token expirado." });
    }

    const hash = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { password: hash },
      }),
      prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return res.json({ ok: true });
  } catch (e) {
    return res.status(400).json({
      message: "Dados inválidos",
      error: e?.issues ?? String(e),
    });
  }
});

export default router;
