import type { SupabaseClient } from "@supabase/supabase-js";

/** Retail rate card (KES). AI usage is bundled into the per-minute rate. */
export const WALLET_RATE_KES_PER_MINUTE = Number(
  process.env.WALLET_RATE_KES_PER_MINUTE || process.env.NEXT_PUBLIC_WALLET_RATE_KES_PER_MINUTE || 15
);
export const WALLET_LINE_FEE_KES_PER_MONTH = Number(
  process.env.WALLET_LINE_FEE_KES_PER_MONTH ||
    process.env.NEXT_PUBLIC_WALLET_LINE_FEE_KES_PER_MONTH ||
    1000
);
export const WALLET_LOW_BALANCE_KES = 200;

/** @deprecated Use WALLET_RATE_KES_PER_MINUTE */
export const BETA_RATE_KES_PER_MINUTE = WALLET_RATE_KES_PER_MINUTE;
/** @deprecated Use WALLET_LINE_FEE_KES_PER_MONTH */
export const BETA_LINE_FEE_KES_PER_MONTH = WALLET_LINE_FEE_KES_PER_MONTH;

export type WalletLedgerRow = {
  id: string;
  created_at: string;
  kind: string;
  amount_kes: number;
  balance_after_kes: number;
  note: string | null;
  reference_type: string | null;
  reference_id: string | null;
};

export type TenantUsageSummary = {
  callsThisMonth: number;
  secondsThisMonth: number;
  minutesThisMonth: number;
  estimatedCostKes: number;
  callChargesKes: number;
  lineFeeKes: number;
  daysRemainingAtPace: number | null;
  walletBalanceKes: number;
  lowBalance: boolean;
  recentLedger: WalletLedgerRow[];
};

function startOfMonthUtcIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function currentPeriodUtc(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

/** Resolve balance from one-wallet column, with dual-wallet fallback pre-migration. */
export function resolveWalletBalanceKes(wallets: {
  walletKes?: number | null;
  telecomKes?: number | null;
  aiUsd?: number | null;
}): number {
  if (wallets.walletKes != null && Number.isFinite(Number(wallets.walletKes))) {
    return Number(wallets.walletKes);
  }
  const telecom = Number(wallets.telecomKes ?? 0);
  const aiUsd = Number(wallets.aiUsd ?? 0);
  return telecom + Math.round(aiUsd * 130);
}

/**
 * Lazy-apply monthly line rental (idempotent). Safe if RPC missing (pre-migration).
 */
export async function ensureLineRentalApplied(
  client: SupabaseClient,
  tenantId: string,
  amountKes: number = WALLET_LINE_FEE_KES_PER_MONTH
): Promise<number | null> {
  const { data, error } = await client.rpc("apply_line_rental", {
    p_tenant_id: tenantId,
    p_period: currentPeriodUtc(),
    p_amount_kes: amountKes,
  });
  if (error) {
    // Pre-migration or enforcement off — ignore.
    if (/function|does not exist|schema cache/i.test(error.message)) return null;
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row?.wallet_balance_kes != null ? Number(row.wallet_balance_kes) : null;
}

export async function getTenantUsageSummary(
  client: SupabaseClient,
  tenantId: string,
  wallets: { walletKes?: number | null; telecomKes?: number | null; aiUsd?: number | null }
): Promise<TenantUsageSummary> {
  let walletBalanceKes = resolveWalletBalanceKes(wallets);

  try {
    const applied = await ensureLineRentalApplied(client, tenantId);
    if (applied != null) walletBalanceKes = applied;
  } catch {
    // Non-fatal: usage still loads.
  }

  const since = startOfMonthUtcIso();
  const [callsRes, ledgerRes, chargesRes] = await Promise.all([
    client
      .from("calls")
      .select("duration_seconds, ai_processing_minutes")
      .eq("tenant_id", tenantId)
      .gte("created_at", since),
    client
      .from("wallet_ledger")
      .select("id, created_at, kind, amount_kes, balance_after_kes, note, reference_type, reference_id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(12),
    client
      .from("wallet_ledger")
      .select("amount_kes, kind")
      .eq("tenant_id", tenantId)
      .gte("created_at", since)
      .in("kind", ["call_charge", "line_rental"]),
  ]);

  if (callsRes.error) throw callsRes.error;

  const rows = callsRes.data || [];
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

  const estimatedCostKes = Math.round(minutesThisMonth * WALLET_RATE_KES_PER_MINUTE);

  let callChargesKes = 0;
  let lineFeeKes = 0;
  if (!chargesRes.error && chargesRes.data) {
    for (const row of chargesRes.data) {
      const amt = Math.abs(Number(row.amount_kes) || 0);
      if (row.kind === "line_rental") lineFeeKes += amt;
      else callChargesKes += amt;
    }
  }

  const dayOfMonth = Math.max(1, new Date().getUTCDate());
  const minutesPerDay = minutesThisMonth / dayOfMonth;
  let daysRemainingAtPace: number | null = null;
  if (minutesPerDay > 0 && walletBalanceKes > 0) {
    const kesPerDay = minutesPerDay * WALLET_RATE_KES_PER_MINUTE;
    daysRemainingAtPace = Math.max(0, Math.round(walletBalanceKes / kesPerDay));
  }

  const recentLedger: WalletLedgerRow[] = !ledgerRes.error
    ? (ledgerRes.data || []).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        kind: row.kind,
        amount_kes: Number(row.amount_kes),
        balance_after_kes: Number(row.balance_after_kes),
        note: row.note ?? null,
        reference_type: row.reference_type ?? null,
        reference_id: row.reference_id ?? null,
      }))
    : [];

  return {
    callsThisMonth: rows.length,
    secondsThisMonth: seconds,
    minutesThisMonth,
    estimatedCostKes,
    callChargesKes,
    lineFeeKes,
    daysRemainingAtPace,
    walletBalanceKes,
    lowBalance: walletBalanceKes < WALLET_LOW_BALANCE_KES,
    recentLedger,
  };
}
