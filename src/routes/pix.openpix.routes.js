import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

const OPENPIX_BASE = "https://api.openpix.com.br";
const OPENPIX_APP_ID = process.env.OPENPIX_APP_ID; // AppID da Woovi/OpenPix

function assertEnv() {
  if (!OPENPIX_APP_ID) throw new Error("OPENPIX_APP_ID ausente");
}

async function openpix(path, { method = "GET", body } = {}) {
  assertEnv();
  const res = await fetch(`${OPENPIX_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: OPENPIX_APP_ID,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenPix ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// 🔒 usuário logado cria/pega cobrança da própria reserva
router.use(authRequired);

/**
 * POST /pix/reservations/:id/charge
 * - cria a cobrança Pix na OpenPix (ou retorna a existente)
 * - reserva precisa estar PENDING e UNPAID
 */
router.post("/reservations/:id/charge", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { court: { include: { arena: true } } },
    });
    if (!reservation) return res.status(404).json({ error: "Reserva não encontrada" });
    if (reservation.userId !== userId && req.user.role !== "admin") {
      return res.status(403).json({ error: "Sem permissão" });
    }

    // Só gera cobrança se ainda não foi paga/cancelada
    if (reservation.status === "CANCELED") {
      return res.status(409).json({ error: "Reserva cancelada" });
    }
    if (reservation.paymentStatus === "PAID") {
      return res.status(409).json({ error: "Reserva já está paga" });
    }

    const value = Number(reservation.totalPrice || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ error: "Reserva sem totalPrice válido" });
    }

    // Se já existe PixPayment, devolve (reuso)
    const existing = await prisma.pixPayment.findUnique({
      where: { reservationId: reservation.id },
    });
    if (existing?.brCode) {
      return res.json({
        paymentId: existing.id,
        status: existing.status,
        brCode: existing.brCode,
        qrCodeImage: existing.qrCodeImage,
        expiresAt: existing.expiresAt,
      });
    }

    // correlationId único (serve pra achar no webhook)
    const correlationId = `resv_${reservation.id}_${Date.now()}`;

    // Cria registro local primeiro
    const payment = await prisma.pixPayment.create({
      data: {
        reservationId: reservation.id,
        correlationId,
        value,
        status: "CREATED",
      },
    });

    // Cria charge na OpenPix
    // A OpenPix usa value em CENTAVOS normalmente (confira no painel: se for em reais, ajuste)
    const chargeBody = {
      correlationID: correlationId,
      value,
      comment: `Reserva BoraPo - ${reservation.court?.arena?.name || "Arena"} (${reservation.id})`,
      expiresIn: 15 * 60, // 15 min
    };

    const resp = await openpix("/api/v1/charge", { method: "POST", body: chargeBody });

    // Estrutura típica: resp.charge / resp.charge.qrcode / resp.charge.brCode
    const ch = resp?.charge || resp?.data?.charge || resp;

    const updated = await prisma.pixPayment.update({
      where: { id: payment.id },
      data: {
        status: "PENDING",
        chargeId: ch?.id || null,
        txid: ch?.txid || null,
        brCode: ch?.brCode || ch?.pixKey || ch?.paymentLink || ch?.qrCode?.brCode || null,
        qrCodeImage: ch?.qrCodeImage || ch?.qrCode?.image || null,
        expiresAt: ch?.expiresAt ? new Date(ch.expiresAt) : null,
        raw: ch ? ch : resp,
      },
    });

    return res.json({
      paymentId: updated.id,
      status: updated.status,
      brCode: updated.brCode,
      qrCodeImage: updated.qrCodeImage,
      expiresAt: updated.expiresAt,
    });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "Erro" });
  }
});

/**
 * GET /pix/payments/:paymentId
 * (front faz polling pra saber quando ficou PAID)
 */
router.get("/payments/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const p = await prisma.pixPayment.findUnique({ where: { id: paymentId } });
    if (!p) return res.status(404).json({ error: "Pagamento não encontrado" });
    return res.json({
      id: p.id,
      status: p.status,
      brCode: p.brCode,
      qrCodeImage: p.qrCodeImage,
      expiresAt: p.expiresAt,
      paidAt: p.paidAt,
    });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "Erro" });
  }
});

export default router;