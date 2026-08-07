import type { SupabaseClient } from "@supabase/supabase-js";

/** Illustrative retail rates for beta burn-rate estimates (not charged). */
export const BETA_RATE_KES_PER_MINUTE = 15;
export const BETA_LINE_FEE_KES_PER_MONTH = 1000;

export type TenantUsageSummary = {
  callsThisMonth: number;
  secondsThisMonth: number;
  minutesThisMonth: number;
  estimatedCostKes: number;
  daysRemainingAtPace: number | null;
  telecomBalanceKes: number;
  aiBalanceUsd: number;
};

function startOfMonthNairobiIso(): string {
  // Approximate: use UTC month start; good enough for beta rollups.
  // (Strict Nairobi TZ rollup can be added later with a Postgres function.)
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function getTenantUsageSummary(
  client: SupabaseClient,
  tenantId: string,
  wallets: { telecomKes?: number | null; aiUsd?: number | null }
): Promise<TenantUsageSummary> {
  const since = startOfMonthNairobiIso();
  const { data, error } = await client
    .from("calls")
    .select("duration_seconds, ai_processing_minutes")
    .eq("tenant_id", tenantId)
    .gte("created_at", since);

  if (error) throw error;

  const rows = data || [];
  let seconds = 0;
  let minutesFromCol = 0;
  let usedAiCol = false;

  for (const row of rows) {
    const dur = Number(row.duration_seconds) || 0;
    seconds += Math.max(0, dur);
    if (row.ai_processing_minutes != null && Number.isFinite(Number(row.ai_processing_minutes))) {
      minutesFromCol += Number(row.ai_processing_minutes);
      usedAiCol = true;
    }
  }

  const minutesThisMonth = usedAiCol
    ? Math.round(minutesFromCol * 10) / 10
    : Math.round((seconds / 60) * 10) / 10;

  const estimatedCostKes = Math.round(minutesThisMonth * BETA_RATE_KES_PER_MINUTE);
  const telecomBalanceKes = Number(wallets.telecomKes ?? 0);
  const aiBalanceUsd = Number(wallets.aiUsd ?? 0);

  // Pace: minutes so far / day-of-month → days balance would last at that pace
  // using illustrative KES rate against telecom wallet only.
  const dayOfMonth = Math.max(1, new Date().getUTCDate());
  const minutesPerDay = minutesThisMonth / dayOfMonth;
  let daysRemainingAtPace: number | null = null;
  if (minutesPerDay > 0 && telecomBalanceKes > 0) {
    const kesPerDay = minutesPerDay * BETA_RATE_KES_PER_MINUTE;
    daysRemainingAtPace = Math.max(0, Math.round(telecomBalanceKes / kesPerDay));
  }

  return {
    callsThisMonth: rows.length,
    secondsThisMonth: seconds,
    minutesThisMonth,
    estimatedCostKes,
    daysRemainingAtPace,
    telecomBalanceKes,
    aiBalanceUsd,
  };
}
