import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Fixed-window limit backed by public.hit_rate_limit (migration 20261011150000).
 * Atomic in Postgres, so it holds across serverless instances. Fails open (and logs)
 * when the function is missing, so a database without the migration still signs people up.
 */
export async function allowRate(bucket: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("hit_rate_limit", {
      p_bucket: bucket,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) {
      console.warn("[rateLimit]", bucket.split(":")[0], error.message);
      return true;
    }
    return data !== false;
  } catch (err) {
    console.warn("[rateLimit]", err instanceof Error ? err.message : err);
    return true;
  }
}

/** All limits must pass. Each bucket is counted even if an earlier one fails. */
export async function allowAll(
  checks: Array<{ bucket: string; windowSeconds: number; max: number }>
): Promise<boolean> {
  const results = await Promise.all(checks.map((c) => allowRate(c.bucket, c.windowSeconds, c.max)));
  return results.every(Boolean);
}

/** First hop of x-forwarded-for (Vercel), else x-real-ip, else "unknown". */
export function clientIpFrom(get: (name: string) => string | null | undefined): string {
  const fwd = String(get("x-forwarded-for") || "").split(",")[0].trim();
  return fwd || String(get("x-real-ip") || "").trim() || "unknown";
}
