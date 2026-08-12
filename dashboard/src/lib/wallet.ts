import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";

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

/** Owner soft spend budget presets (KES / calendar month UTC). Opt-in only. */
export const SOFT_SPEND_LIMIT_PRESETS_KES = [2000, 5000, 10000, 20000] as const;
export const SOFT_SPEND_LIMIT_MIN_KES = 500;
export const SOFT_SPEND_LIMIT_MAX_KES = 1_000_000;
/** Soft warning thresholds (percent of monthly limit). Never blocks calls. */
export const SOFT_SPEND_WARN_THRESHOLDS = [50, 80, 100] as const;

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

export type SoftSpendLimitStatus = {
  enabled: boolean;
  limitKes: number | null;
  /** Month-to-date spend counted against the soft budget. */
  spentKes: number;
  percent: number;
  /** Highest crossed warn threshold (0 | 50 | 80 | 100). */
  thresholdReached: 0 | 50 | 80 | 100;
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
  billingEnforcement: string;
  isBeta: boolean;
  recentLedger: WalletLedgerRow[];
  softSpendLimit: SoftSpendLimitStatus;
};

export function normalizeSoftSpendLimitKes(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < SOFT_SPEND_LIMIT_MIN_KES || rounded > SOFT_SPEND_LIMIT_MAX_KES) return null;
  return rounded;
}

export function resolveSoftSpendLimitStatus(opts: {
  enabled?: boolean | null;
  limitKes?: number | null;
  spentKes: number;
}): SoftSpendLimitStatus {
  const limit = opts.limitKes != null && Number.isFinite(Number(opts.limitKes))
    ? Number(opts.limitKes)
    : null;
  const enabled = Boolean(opts.enabled) && limit != null && limit > 0;
  const spent = Math.max(0, Number(opts.spentKes) || 0);
  if (!enabled || !limit) {
    return {
      enabled: false,
      limitKes: null,
      spentKes: spent,
      percent: 0,
      thresholdReached: 0,
    };
  }
  const percent = Math.min(999, (spent / limit) * 100);
  let thresholdReached: SoftSpendLimitStatus["thresholdReached"] = 0;
  for (const t of SOFT_SPEND_WARN_THRESHOLDS) {
    if (percent >= t) thresholdReached = t;
  }
  return {
    enabled: true,
    limitKes: limit,
    spentKes: spent,
    percent,
    thresholdReached,
  };
}

export function softSpendLimitMessage(status: SoftSpendLimitStatus): string | null {
  if (!status.enabled || !status.limitKes) return null;
  if (status.thresholdReached >= 100) {
    return `Soft limit reached (KES ${status.limitKes.toLocaleString("en-KE")} this month). Calls still work — raise or turn off the limit if you want.`;
  }
  if (status.thresholdReached >= 80) {
    return `Approaching your soft limit (${Math.round(status.percent)}% of KES ${status.limitKes.toLocaleString("en-KE")}).`;
  }
  if (status.thresholdReached >= 50) {
    return `Halfway through your soft monthly budget.`;
  }
  return null;
}

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
 * Lazy-apply monthly line rental via service role only (owners cannot choose amount).
 * No-op when workspace is on beta (`billing_enforcement = off`).
 */
export async function ensureLineRentalApplied(
  tenantId: string,
  amountKes: number = WALLET_LINE_FEE_KES_PER_MONTH
): Promise<number | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("apply_line_rental", {
    p_tenant_id: tenantId,
    p_period: currentPeriodUtc(),
    p_amount_kes: amountKes,
  });
  if (error) {
    if (/function|does not exist|schema cache|permission|not authorized/i.test(error.message)) {
      return null;
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row?.wallet_balance_kes != null ? Number(row.wallet_balance_kes) : null;
}

export async function getTenantUsageSummary(
  client: SupabaseClient,
  tenantId: string,
  wallets: {
    walletKes?: number | null;
    telecomKes?: number | null;
    aiUsd?: number | null;
    billingEnforcement?: string | null;
    softSpendLimitEnabled?: boolean | null;
    softSpendLimitKes?: number | null;
  }
): Promise<TenantUsageSummary> {
  let walletBalanceKes = resolveWalletBalanceKes(wallets);
  const billingEnforcement = wallets.billingEnforcement || "off";
  const isBeta = billingEnforcement === "off";

  // Only charge line fee for prepaid workspaces.
  if (billingEnforcement !== "off") {
    try {
      const applied = await ensureLineRentalApplied(tenantId);
      if (applied != null) walletBalanceKes = applied;
    } catch {
      // Non-fatal: usage still loads.
    }
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

  // Soft budget counts prepaid ledger spend; beta uses illustrative rate-card cost.
  const softSpentKes = isBeta ? estimatedCostKes : callChargesKes + lineFeeKes;
  const softSpendLimit = resolveSoftSpendLimitStatus({
    enabled: wallets.softSpendLimitEnabled,
    limitKes: wallets.softSpendLimitKes,
    spentKes: softSpentKes,
  });

  return {
    callsThisMonth: rows.length,
    secondsThisMonth: seconds,
    minutesThisMonth,
    estimatedCostKes,
    callChargesKes,
    lineFeeKes,
    daysRemainingAtPace,
    walletBalanceKes,
    lowBalance: !isBeta && walletBalanceKes < WALLET_LOW_BALANCE_KES,
    billingEnforcement,
    isBeta,
    recentLedger,
    softSpendLimit,
  };
}
