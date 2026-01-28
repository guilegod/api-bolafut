import nodemailer from "nodemailer";

export function makeMailer() {
  const host = process.env.SMTP_HOST || "smtp.hostinger.com";
  const port = Number(process.env.SMTP_PORT || 465);

  // 465 = secure true / SSL
  const secure = String(process.env.SMTP_SECURE || "true") === "true";

  const user = process.env.SMTP_USER; // ex: suporte@borapo.com
  const pass = process.env.SMTP_PASS; // senha do e-mail
  const from = process.env.SMTP_FROM || user || "suporte@borapo.com";

  if (!user || !pass) {
    console.warn("[mailer] SMTP_USER/SMTP_PASS não configurados");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  return { transporter, from, isReady: !!(user && pass) };
}
