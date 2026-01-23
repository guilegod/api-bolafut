import { createClient } from "@supabase/supabase-js";

/**
 * Supabase Admin client (Service Role) — usado NO BACKEND.
 *
 * Requer no .env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getSupabaseAdmin() {
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env para upload de imagem."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
