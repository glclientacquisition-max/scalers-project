/** Strip accidental /rest/v1 suffix from project URL. */
export function normalizeSupabaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
}

export function getSupabaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!raw) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)");
  }
  return normalizeSupabaseUrl(raw);
}

export function getSupabaseAnonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)");
  }
  return key;
}
