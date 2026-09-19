/** Strip accidental /rest/v1 suffix from project URL. */
export function normalizeSupabaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
}

function nonempty(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getSupabaseUrl(): string {
  // Prefer the server URL. Next inlines NEXT_PUBLIC_* at build, so a blank
  // public bake must not hide a runtime SUPABASE_URL on /api/login.
  const raw =
    nonempty(process.env.SUPABASE_URL) ||
    nonempty(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!raw) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)");
  }
  return normalizeSupabaseUrl(raw);
}

export function getSupabaseAnonKey(): string {
  const key =
    nonempty(process.env.SUPABASE_ANON_KEY) ||
    nonempty(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    nonempty(process.env.SUPABASE_PUBLISHABLE_KEY) ||
    nonempty(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (!key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)");
  }
  return key;
}
