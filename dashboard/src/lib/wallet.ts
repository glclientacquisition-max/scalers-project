import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";

/** Retail rate card (KES). AI usage is bundled into the per-minute rate. */
export const WALLET_RATE_KES_PER_MINUTE = Number(
  process.env.WALLET_RATE_KES_PER_MINUTE || process.env.NEXT_PUBLIC_WALLET_RATE_KES_PER_MINUTE || 0
);
export const WALLET_TRANSFER_RATE_KES_PER_MINUTE = Number(
  process.env.WALLET_TRANSFER_RATE_KES_PER_MINUTE ||
    process.env.NEXT_PUBLIC_WALLET_TRANSFER_RATE_KES_PER_MINUTE ||
    4
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
  ledgerTotal: number;
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
    return `Soft limit reached (KES ${status.limitKes.toLocaleString("en-KE")} this month). Calls still work. Raise or turn off the limit if you want.`;
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

/** Beta workspaces are metered, never charged. One rule for every surface. */
export function isBetaBilling(billingEnforcement?: string | null): boolean {
  return (billingEnforcement || "off") === "off";
}

/** Month-to-date call minutes from durations or the AI minutes column. */
function minutesFromCallRows(
  rows: { duration_seconds: number | null; ai_processing_minutes: number | null }[]
): { seconds: number; minutes: number } {
  let seconds = 0;
  let minutesFromCol = 0;
  let usedAiCol = false;
  for (const row of rows) {
    seconds += Math.max(0, Number(row.duration_seconds) || 0);
    if (
      row.ai_processing_minutes != null &&
      Number.isFinite(Number(row.ai_processing_minutes))
    ) {
      minutesFromCol += Number(row.ai_processing_minutes);
      usedAiCol = true;
    }
  }
  return {
    seconds,
    minutes: usedAiCol
      ? Math.round(minutesFromCol * 10) / 10
      : Math.round((seconds / 60) * 10) / 10,
  };
}

/** Days the prepaid balance lasts at the current call pace. Null when no pace or no balance. */
export function runwayDaysAtPace(opts: {
  minutesThisMonth: number;
  dayOfMonth: number;
  balanceKes: number;
}): number | null {
  const minutesPerDay = opts.minutesThisMonth / Math.max(1, opts.dayOfMonth);
  if (minutesPerDay <= 0 || opts.balanceKes <= 0) return null;
  const kesPerDay = minutesPerDay * WALLET_RATE_KES_PER_MINUTE;
  return Math.max(0, Math.round(opts.balanceKes / kesPerDay));
}

/** Light runway read for surfaces that only need the pace caption (Home). One calls query. */
export async function getWalletRunwayDays(
  client: SupabaseClient,
  tenantId: string,
  balanceKes: number
): Promise<number | null> {
  if (balanceKes <= 0) return null;
  const res = await client
    .from("calls")
    .select("duration_seconds, ai_processing_minutes")
    .eq("tenant_id", tenantId)
    .gte("created_at", startOfMonthUtcIso());
  if (res.error) return null;
  const { minutes } = minutesFromCallRows(res.data || []);
  return runwayDaysAtPace({
    minutesThisMonth: minutes,
    dayOfMonth: new Date().getUTCDate(),
    balanceKes,
  });
}

/** Quiet pace caption. Shown only when the answer is decision-useful (1 to 90 days). */
export function walletRunwayLabel(days: number | null): string | null {
  if (days == null || days <= 0 || days > 90) return null;
  if (days < 14) return `about ${days} day${days === 1 ? "" : "s"} at this pace`;
  if (days < 56) {
    const weeks = Math.round(days / 7);
    return `about ${weeks} week${weeks === 1 ? "" : "s"} at this pace`;
  }
  const months = Math.round(days / 30);
  return `about ${months} month${months === 1 ? "" : "s"} at this pace`;
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
    ledgerPage?: number;
    ledgerPageSize?: number;
  }
): Promise<TenantUsageSummary> {
  let walletBalanceKes = resolveWalletBalanceKes(wallets);
  const billingEnforcement = wallets.billingEnforcement || "off";
  const isBeta = isBetaBilling(billingEnforcement);

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
  const ledgerSize = Math.max(1, Math.floor(wallets.ledgerPageSize || 25));
  const ledgerPage = Math.max(1, Math.floor(wallets.ledgerPage || 1));
  const ledgerFrom = (ledgerPage - 1) * ledgerSize;
  const [callsRes, ledgerRes, chargesRes] = await Promise.all([
    client
      .from("calls")
      .select("duration_seconds, ai_processing_minutes")
      .eq("tenant_id", tenantId)
      .gte("created_at", since),
    client
      .from("wallet_ledger")
      .select(
        "id, created_at, kind, amount_kes, balance_after_kes, note, reference_type, reference_id",
        { count: "exact" }
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(ledgerFrom, ledgerFrom + ledgerSize - 1),
    client
      .from("wallet_ledger")
      .select("amount_kes, kind")
      .eq("tenant_id", tenantId)
      .gte("created_at", since)
      .in("kind", ["call_charge", "line_rental"]),
  ]);

  if (callsRes.error) throw callsRes.error;

  const rows = callsRes.data || [];
  const { seconds, minutes: minutesThisMonth } = minutesFromCallRows(rows);

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
  const daysRemainingAtPace = runwayDaysAtPace({
    minutesThisMonth,
    dayOfMonth,
    balanceKes: walletBalanceKes,
  });

  const ledgerTotal = !ledgerRes.error ? ledgerRes.count ?? (ledgerRes.data || []).length : 0;
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
    ledgerTotal,
    softSpendLimit,
  };
}
