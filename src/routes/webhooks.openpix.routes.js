import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";

const router = Router();

// ⚠️ IMPORTANTE: pra validar assinatura, você precisa do RAW BODY.
// No seu server principal, você deve usar express.json com verify (te passo já abaixo).
function validateSignature(rawBody, signature, secret) {
  if (!secret) return false;
  if (!signature) return false;

  // ⚠️ A OpenPix tem variações de assinatura conforme configuração.
  // Esse HMAC-SHA1 base64 é o padrão mais comum.
  const h = crypto.createHmac("sha1", secret).update(rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(signature));
}

/**
 * POST /webhooks/openpix
 * - OpenPix chama quando o Pix for pago
 * - você marca PixPayment=PAID e Reservation=CONFIRMED + paymentStatus=PAID
 */
router.post("/openpix", async (req, res) => {
  try {
    const secret = process.env.OPENPIX_WEBHOOK_SECRET;
    const signature =
      req.headers["x-webhook-signature"] ||
      req.headers["x-openpix-signature"] ||
      "";

    const rawBody = req.rawBody || ""; // vem do verify do express.json

    // Em produção: valida assinatura (se estiver ativada no painel)
    if (secret) {
      const ok = validateSignature(rawBody, String(signature), secret);
      if (!ok) return res.status(401).json({ error: "Assinatura inválida" });
    }

    // O payload da OpenPix costuma vir com charge / pix / correlationID
    const body = req.body || {};
    const correlationId =
      body?.charge?.correlationID ||
      body?.charge?.correlationId ||
      body?.correlationID ||
      body?.correlationId ||
      null;

    const chargeId = body?.charge?.id || body?.chargeId || null;
    const txid = body?.charge?.txid || body?.txid || null;

    // Acha pagamento
    const payment = await prisma.pixPayment.findFirst({
      where: correlationId
        ? { correlationId: String(correlationId) }
        : chargeId
        ? { chargeId: String(chargeId) }
        : txid
        ? { txid: String(txid) }
        : { id: "__nope__" },
      include: { reservation: true },
    });

    if (!payment) {
      // responde 200 pra não ficar re-tentando infinito
      return res.json({ ok: true, ignored: true });
    }

    // Idempotência: se já pago, ok
    if (payment.status === "PAID" || payment.reservation?.paymentStatus === "PAID") {
      return res.json({ ok: true, already: true });
    }

    // ✅ Marca pagamento como PAID
    await prisma.pixPayment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        raw: body,
      },
    });

    // ✅ Confirma reserva automaticamente
    await prisma.reservation.update({
      where: { id: payment.reservationId },
      data: {
        status: "CONFIRMED",
        paymentStatus: "PAID",
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    // melhor retornar 200 se quiser evitar retries agressivos em dev,
    // mas em prod normalmente é 500 pra re-tentar.
    return res.status(400).json({ error: e?.message || "Erro" });
  }
});

export default router;