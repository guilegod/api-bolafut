import crypto from "crypto";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

function parseBase64(data) {
  if (!data) return null;
  const raw = String(data);
  const match = raw.match(/^data:(.+);base64,(.*)$/);
  if (match) {
    return { mime: match[1], b64: match[2] };
  }
  return { mime: "image/png", b64: raw };
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("png")) return "png";
  return "png";
}

export async function uploadArenaImageBase64({ arenaId, base64 }) {
  const parsed = parseBase64(base64);
  if (!parsed?.b64) return null;

  const supabase = getSupabaseAdmin();
  const bucket = process.env.SUPABASE_BUCKET_ARENAS || "arenas";

  const buffer = Buffer.from(parsed.b64, "base64");
  const ext = extFromMime(parsed.mime);
  const file = `arena_${arenaId}/${Date.now()}_${crypto.randomBytes(6).toString("hex")}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(file, buffer, {
    contentType: parsed.mime || "image/png",
    upsert: true,
  });

  if (error) throw new Error(`Falha ao enviar imagem: ${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(file);
  return data?.publicUrl || null;
}
