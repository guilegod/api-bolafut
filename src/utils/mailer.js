import nodemailer from "nodemailer";

export function makeMailer() {
  const host = process.env.SMTP_HOST || "smtp.hostinger.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || "true") === "true";

  const user = process.env.SMTP_USER; // ex: no-reply@borapo.com
  const pass = process.env.SMTP_PASS; // senha do e-mail

  if (!user || !pass) {
    console.warn("[mailer] SMTP_USER/SMTP_PASS não configurados");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}
