import { getSupabaseAdmin } from "@/lib/supabase";
import {
  type BillingMode,
  listAdminWallets,
  listTenantLedger,
} from "@/lib/adminWallets";
import {
  loadPackageCatalog,
  minutesUsedFromSeconds,
  remainingCount,
  type BillingPackage,
  type BillingRateCard,
  type TenantSubscriptionRow,
} from "@/lib/packageCatalog";
import type { WalletLedgerRow } from "@/lib/wallet";
import { actionLabel, eatStamp } from "@/lib/adminActivityModel";
import { billingAuditDetail, ledgerKindLabel } from "@/lib/adminBillingCopy";
import { periodEndLabel } from "@/lib/billingStateModel";
import { earliestPeriodEndLabel, periodEndWithinRolloverWindow } from "@/lib/adminBillingPeriod";
import type { AdminBillingOverview, AdminBillingRow, AdminBillingStatus } from "@/lib/adminBillingTypes";
import { reviewReasonFromRaw } from "@/lib/adminPayCopy";
import { logAdminError, isMissingTableError } from "@/lib/adminErrors";

export type { AdminBillingOverview, AdminBillingRow, AdminBillingStatus } from "@/lib/adminBillingTypes";

export type OpsAuditRow = {
  id: string;
  created_at: string;
  actor: string;
  action: string;
  amount_kes: number | null;
  detail: Record<string, unknown> | null;
};

export type BillingHistoryEntry = {
  id: string;
  created_at: string;
  /** Plain label, e.g. "Changed package" or "Call charge". */
  title: string;
  /** What changed and why, e.g. "Starter / month → Growth / month · upgrade". */
  detail: string | null;
  /** Signed-in Super Admin for admin actions; null for charge lines. */
  actor: string | null;
  /** "9 Oct 13:05" in Nairobi time. */
  when: string;
  amount_kes: number | null;
};

const LOW_MINUTES_THRESHOLD = 50;

function billingStatus(input: {
  is_active: boolean | null;
  billing_enforcement: BillingMode;
  minutesRemaining: number;
  minutesIncluded: number;
  on_demand: boolean;
}): { status: AdminBillingStatus; statusLabel: string } {
  if (input.is_active === false) {
    return { status: "archived", statusLabel: "Archived" };
  }
  if (input.minutesIncluded > 0 && input.minutesRemaining <= 0 && !input.on_demand) {
    return { status: "exhausted", statusLabel: "Exhausted" };
  }
  if (
    input.minutesIncluded > 0 &&
    input.minutesRemaining > 0 &&
    input.minutesRemaining <= LOW_MINUTES_THRESHOLD
  ) {
    return { status: "low_minutes", statusLabel: "Low minutes" };
  }
  if (input.billing_enforcement !== "off") {
    return { status: "charging", statusLabel: "Charging" };
  }
  return { status: "ok", statusLabel: "OK" };
}

/** Super Admin plan row copy (not owner desk). */
export function adminModeLabel(mode: BillingMode): string {
  if (mode === "off") return "Beta · Meter only";
  if (mode === "soft") return "Charging · On-demand";
  return "Charging · Block at cap";
}

export function chargingModeLabel(mode: BillingMode): string {
  return adminModeLabel(mode);
}

function isMissingBillingState(message: string): boolean {
  return /tenant_billing_state|does not exist|schema cache/i.test(message);
}

export async function loadAdminBillingOverview(): Promise<AdminBillingOverview> {
  const { loadPlatformInvoiceStats } = await import("@/lib/adminBillingInvoices");
  const [walletOverview, catalog, invoiceStats] = await Promise.all([
    listAdminWallets(),
    loadPackageCatalog(),
    loadPlatformInvoiceStats(),
  ]);

  const subByTenant = new Map(
    catalog.businesses.map((b) => [
      b.tenantId,
      {
        packageName: b.packageName,
        packageId: b.packageId,
        period: b.period,
        usage: b.usage,
      },
    ])
  );
  const skuById = new Map(catalog.packages.map((p) => [p.id, p.sku]));

  const rows: AdminBillingRow[] = walletOverview.rows.map((w) => {
    const sub = subByTenant.get(w.id);
    const minutesIncluded = sub?.usage.minutesIncluded ?? 0;
    const minutesUsed = minutesUsedFromSeconds(sub?.usage.secondsUsed ?? 0);
    const minutesRemaining = remainingCount(minutesIncluded, minutesUsed);
    const onDemand = false; // filled below from tenants query batch

    const { status, statusLabel } = billingStatus({
      is_active: w.is_active,
      billing_enforcement: w.billing_enforcement,
      minutesRemaining,
      minutesIncluded,
      on_demand: onDemand,
    });

    return {
      id: w.id,
      business_name: w.business_name,
      sautikit_virtual_number: w.sautikit_virtual_number,
      packageName: sub?.packageName ?? null,
      packageSku: sub?.packageId ? skuById.get(sub.packageId) ?? null : null,
      period: sub?.period ?? null,
      periodEnd: null,
      periodEndLabel: null,
      minutesIncluded,
      minutesUsed,
      minutesRemaining,
      billing_enforcement: w.billing_enforcement,
      on_demand_usage_enabled: false,
      status,
      statusLabel,
    };
  });

  const admin = getSupabaseAdmin();
  const periodRes = await admin
    .from("tenant_billing_state")
    .select("tenant_id, period_end")
    .in(
      "tenant_id",
      rows.map((r) => r.id),
    );
  if (!periodRes.error) {
    const endByTenant = new Map(
      (periodRes.data || []).map((row) => [String(row.tenant_id), row.period_end ? String(row.period_end) : null]),
    );
    for (const row of rows) {
      const periodEnd = endByTenant.get(row.id) ?? null;
      row.periodEnd = periodEnd;
      row.periodEndLabel = periodEnd ? periodEndLabel(periodEnd) : null;
    }
  } else if (!isMissingBillingState(periodRes.error.message || "")) {
    throw periodRes.error;
  }
  const { data: onDemandRows } = await admin
    .from("tenants")
    .select("id, on_demand_usage_enabled")
    .in(
      "id",
      rows.map((r) => r.id)
    );

  const onDemandById = new Map(
    (onDemandRows || []).map((row) => [String(row.id), Boolean(row.on_demand_usage_enabled)])
  );
  const activeById = new Map(walletOverview.rows.map((w) => [w.id, w.is_active]));

  for (const row of rows) {
    row.on_demand_usage_enabled = onDemandById.get(row.id) ?? false;
    const { status, statusLabel } = billingStatus({
      is_active: activeById.get(row.id) ?? true,
      billing_enforcement: row.billing_enforcement,
      minutesRemaining: row.minutesRemaining,
      minutesIncluded: row.minutesIncluded,
      on_demand: row.on_demand_usage_enabled,
    });
    row.status = status;
    row.statusLabel = statusLabel;
  }

  const activePackaged = rows.filter((r) => r.status !== "archived" && r.packageName && r.periodEnd);
  const rolloverSoonCount = activePackaged.filter((r) => periodEndWithinRolloverWindow(r.periodEnd)).length;

  return {
    rows,
    betaCount: rows.filter((r) => r.billing_enforcement === "off" && r.status !== "archived").length,
    chargingCount: rows.filter((r) => r.billing_enforcement !== "off" && r.status !== "archived")
      .length,
    lowMinutesCount: rows.filter((r) => r.status === "low_minutes").length,
    exhaustedCount: rows.filter((r) => r.status === "exhausted").length,
    rolloverSoonCount,
    platformPeriodEndLabel: earliestPeriodEndLabel(activePackaged),
    openInvoiceCount: invoiceStats.openCount,
    overdueInvoiceCount: invoiceStats.overdueCount,
    openInvoiceKesLabel: invoiceStats.openKesLabel,
    invoicesMissing: invoiceStats.missing,
  };
}

export type CheckoutReview = {
  provider: string;
  providerRef: string;
  getKes: string;
  seenKes: string;
  reason: string;
  invoiceId: string | null;
};

export type AdminBillingClientDetail = {
  row: AdminBillingRow;
  beta_notes: string | null;
  rates: BillingRateCard;
  packages: BillingPackage[];
  subscription: TenantSubscriptionRow | null;
  checkoutReviews: CheckoutReview[];
  /** Null when the invoice table could not be read. */
  invoiceCount: number | null;
  /** Live payment row for this business. Unavailable when the table cannot be read. */
  livePayments: { available: boolean; enabled: boolean; beta: boolean };
};

function reviewText(raw: unknown, key: "get_kes" | "seen_kes"): string {
  if (!raw || typeof raw !== "object") return "0";
  const value = (raw as Record<string, unknown>)[key];
  if (value == null || String(value).trim() === "") return "0";
  return String(value);
}

async function loadOpenCheckoutReviews(tenantId: string): Promise<CheckoutReview[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("payments")
    .select("provider, provider_ref, raw, invoice_id")
    .eq("tenant_id", tenantId)
    .eq("match_status", "issue")
    .like("provider_ref", "checkout-total-review:%");
  if (error) throw error;
  return (data || []).flatMap((row) => {
    const raw = row.raw;
    const status = raw && typeof raw === "object" ? (raw as { review_status?: string }).review_status : null;
    if (status === "resolved") return [];
    return [{
      provider: String(row.provider || "bachs"),
      providerRef: String(row.provider_ref),
      getKes: reviewText(raw, "get_kes"),
      seenKes: reviewText(raw, "seen_kes"),
      reason: reviewReasonFromRaw(raw),
      invoiceId: row.invoice_id ? String(row.invoice_id) : null,
    }];
  });
}

export async function loadAdminBillingClient(tenantId: string): Promise<AdminBillingClientDetail | null> {
  const overview = await loadAdminBillingOverview();
  const row = overview.rows.find((r) => r.id === tenantId);
  if (!row) return null;

  const catalog = await loadPackageCatalog();
  const subscription = catalog.businesses.find((b) => b.tenantId === tenantId) ?? null;

  const admin = getSupabaseAdmin();
  const { data: tenantExtra } = await admin
    .from("tenants")
    .select("beta_notes, on_demand_usage_enabled, is_active")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantExtra) {
    row.on_demand_usage_enabled = Boolean(tenantExtra.on_demand_usage_enabled);
  }
  const { status, statusLabel } = billingStatus({
    is_active: tenantExtra?.is_active ?? true,
    billing_enforcement: row.billing_enforcement,
    minutesRemaining: row.minutesRemaining,
    minutesIncluded: row.minutesIncluded,
    on_demand: row.on_demand_usage_enabled,
  });
  row.status = status;
  row.statusLabel = statusLabel;

  return {
    row,
    beta_notes: (tenantExtra?.beta_notes as string | null) ?? null,
    rates: catalog.rates,
    packages: catalog.packages,
    subscription,
    checkoutReviews: await loadOpenCheckoutReviews(tenantId),
    invoiceCount: await countInvoices(tenantId),
    livePayments: await loadLivePayments(tenantId, row.billing_enforcement),
  };
}

async function loadLivePayments(
  tenantId: string,
  enforcement: BillingMode,
): Promise<AdminBillingClientDetail["livePayments"]> {
  const admin = getSupabaseAdmin();
  const sub = await admin
    .from("tenant_subscriptions")
    .select("billing_status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  let beta = enforcement === "off";
  if (!sub.error) {
    const status = typeof sub.data?.billing_status === "string" ? sub.data.billing_status : "beta";
    if (status === "beta") beta = true;
  } else if (!isMissingTableError(sub.error)) {
    logAdminError("billing-live-status", sub.error);
  }

  const live = await admin.from("billing_live_tenants").select("enabled").eq("tenant_id", tenantId).maybeSingle();
  if (live.error) {
    const missing =
      isMissingTableError(live.error) || /column .+ does not exist/i.test(String(live.error.message || ""));
    if (!missing) logAdminError("billing-live-tenant", live.error);
    return { available: false, enabled: false, beta };
  }
  return { available: true, enabled: live.data?.enabled === true, beta };
}

async function countInvoices(tenantId: string): Promise<number | null> {
  const admin = getSupabaseAdmin();
  const { count, error } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) {
    const missing = isMissingTableError(error) || /column .+ does not exist/i.test(String(error.message || ""));
    if (!missing) logAdminError("billing-invoice-count", error);
    return null;
  }
  return count ?? 0;
}

export async function loadCheckoutReviewReading(opts: {
  businessId: string;
  providerRef: string;
}): Promise<{ getKes: string; checkoutId: string }> {
  const providerRef = opts.providerRef.trim();
  if (!providerRef.startsWith("checkout-total-review:")) {
    throw new Error("That review is not on this business.");
  }
  const admin = getSupabaseAdmin();
  const { data: row, error: readError } = await admin
    .from("payments")
    .select("provider, tenant_id, match_status, raw")
    .eq("provider_ref", providerRef)
    .eq("tenant_id", opts.businessId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row || row.match_status !== "issue") {
    throw new Error("That review is not on this business.");
  }
  const raw = row.raw;
  const checkoutId = raw && typeof raw === "object" ? String((raw as { checkout_id?: string }).checkout_id || "").trim() : "";
  return { getKes: reviewText(raw, "get_kes"), checkoutId };
}

export async function resolveCheckoutTotalReview(opts: {
  businessId: string;
  providerRef: string;
  actor: string;
  reason: string;
  choice: string;
  totalKes?: string | null;
}): Promise<void> {
  const providerRef = opts.providerRef.trim();
  if (!providerRef.startsWith("checkout-total-review:")) {
    throw new Error("That review is not on this business.");
  }
  if (opts.choice !== "book" && opts.choice !== "nothing") {
    throw new Error("Choose book collected amount or nothing collected.");
  }
  if (opts.reason.trim().length < 3) {
    throw new Error("Add a reason (3 letters or more).");
  }
  const admin = getSupabaseAdmin();
  const { data: row, error: readError } = await admin
    .from("payments")
    .select("provider, tenant_id, match_status")
    .eq("provider_ref", providerRef)
    .eq("tenant_id", opts.businessId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row || row.match_status !== "issue") {
    throw new Error("That review is not on this business.");
  }
  const args: {
    p_provider: string;
    p_provider_ref: string;
    p_actor: string;
    p_reason: string;
    p_choice: string;
    p_total_kes?: string;
  } = {
    p_provider: String(row.provider || "bachs"),
    p_provider_ref: providerRef,
    p_actor: opts.actor,
    p_reason: opts.reason.trim(),
    p_choice: opts.choice,
  };
  if (opts.totalKes != null && String(opts.totalKes).trim() !== "") {
    args.p_total_kes = String(opts.totalKes);
  }
  const { error } = await admin.rpc("resolve_checkout_total_review", args);
  if (error) throw error;
}

export async function grantTenantPackageMinutes(opts: {
  businessId: string;
  minutes: number;
  note: string;
  actor?: string;
  idempotencyKey?: string;
}): Promise<{ minutes_included: number; minutes_granted: number }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("grant_tenant_package_minutes", {
    p_tenant_id: opts.businessId,
    p_minutes: opts.minutes,
    p_note: opts.note,
    p_actor: opts.actor || "ops",
    p_idempotency_key: opts.idempotencyKey || null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    minutes_included: Number(row?.minutes_included ?? 0),
    minutes_granted: Number(row?.minutes_granted ?? 0),
  };
}

/**
 * Clears a negative on-demand balance with waive_tenant_overage. The DB function
 * writes the ops_audit_log row (action waive_overage) and is idempotent per key.
 * A business that owes nothing returns waivedKes 0 and nothing changes.
 */
export async function waiveTenantOverage(opts: {
  businessId: string;
  note: string;
  actor: string;
  idempotencyKey: string;
}): Promise<{ waivedKes: number; balanceKes: number }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("waive_tenant_overage", {
    p_tenant_id: opts.businessId,
    p_note: opts.note,
    p_actor: opts.actor,
    p_idempotency_key: opts.idempotencyKey,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    waivedKes: Number(row?.waived_kes ?? 0),
    balanceKes: Number(row?.wallet_balance_kes ?? 0),
  };
}

export async function listOpsAuditLog(tenantId: string, limit = 40): Promise<OpsAuditRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("ops_audit_log")
    .select("id, created_at, actor, action, amount_kes, detail")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: String(row.id),
    created_at: String(row.created_at),
    actor: String(row.actor || "ops"),
    action: String(row.action || ""),
    amount_kes: row.amount_kes != null ? Number(row.amount_kes) : null,
    detail: (row.detail as Record<string, unknown>) ?? null,
  }));
}

export async function loadBillingHistory(tenantId: string): Promise<BillingHistoryEntry[]> {
  const [ledger, audit] = await Promise.all([
    listTenantLedger(tenantId, 40),
    listOpsAuditLog(tenantId, 40),
  ]);

  const fromLedger: BillingHistoryEntry[] = ledger.map((row: WalletLedgerRow) => ({
    id: `ledger:${row.id}`,
    created_at: row.created_at,
    title: ledgerKindLabel(row.kind),
    detail: row.note?.trim() || null,
    actor: null,
    when: eatStamp(row.created_at),
    amount_kes: row.amount_kes,
  }));

  const fromAudit: BillingHistoryEntry[] = audit.map((row) => ({
    id: `audit:${row.id}`,
    created_at: row.created_at,
    title: actionLabel(row.action),
    detail: billingAuditDetail(row),
    actor: row.actor.trim() || null,
    when: eatStamp(row.created_at),
    amount_kes: row.amount_kes,
  }));

  return [...fromLedger, ...fromAudit]
    .toSorted((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 60);
}
