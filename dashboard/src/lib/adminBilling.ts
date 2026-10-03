import { getSupabaseAdmin } from "@/lib/supabase";
import {
  type BillingMode,
  listAdminWallets,
  listTenantLedger,
  setTenantBillingMode,
  adjustTenantWalletSecure,
} from "@/lib/adminWallets";
import {
  loadPackageCatalog,
  minutesUsedFromSeconds,
  remainingCount,
  type BillingPackage,
  type BillingRateCard,
  type TenantSubscriptionRow,
} from "@/lib/packageCatalog";
import { resolveWalletBalanceKes, type WalletLedgerRow } from "@/lib/wallet";

export type AdminBillingStatus = "archived" | "ok" | "low_minutes" | "exhausted" | "charging";

export type AdminBillingRow = {
  id: string;
  business_name: string;
  sautikit_virtual_number: string;
  packageName: string | null;
  packageSku: string | null;
  period: "month" | "year" | null;
  minutesIncluded: number;
  minutesUsed: number;
  minutesRemaining: number;
  billing_enforcement: BillingMode;
  on_demand_usage_enabled: boolean;
  wallet_balance_kes: number;
  status: AdminBillingStatus;
  statusLabel: string;
};

export type AdminBillingOverview = {
  rows: AdminBillingRow[];
  betaCount: number;
  chargingCount: number;
  lowMinutesCount: number;
  exhaustedCount: number;
};

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
  kind: string;
  summary: string;
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

export function chargingModeLabel(mode: BillingMode): string {
  if (mode === "off") return "Beta";
  if (mode === "soft") return "On-demand soft";
  return "On-demand hard";
}

export async function loadAdminBillingOverview(): Promise<AdminBillingOverview> {
  const [walletOverview, catalog] = await Promise.all([listAdminWallets(), loadPackageCatalog()]);

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
      minutesIncluded,
      minutesUsed,
      minutesRemaining,
      billing_enforcement: w.billing_enforcement,
      on_demand_usage_enabled: false,
      wallet_balance_kes: w.wallet_balance_kes,
      status,
      statusLabel,
    };
  });

  const admin = getSupabaseAdmin();
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

  return {
    rows,
    betaCount: rows.filter((r) => r.billing_enforcement === "off" && r.status !== "archived").length,
    chargingCount: rows.filter((r) => r.billing_enforcement !== "off" && r.status !== "archived")
      .length,
    lowMinutesCount: rows.filter((r) => r.status === "low_minutes").length,
    exhaustedCount: rows.filter((r) => r.status === "exhausted").length,
  };
}

export type AdminBillingClientDetail = {
  row: AdminBillingRow;
  beta_notes: string | null;
  rates: BillingRateCard;
  packages: BillingPackage[];
  subscription: TenantSubscriptionRow | null;
  ledgerRepairEnabled: boolean;
};

export async function loadAdminBillingClient(tenantId: string): Promise<AdminBillingClientDetail | null> {
  const overview = await loadAdminBillingOverview();
  const row = overview.rows.find((r) => r.id === tenantId);
  if (!row) return null;

  const catalog = await loadPackageCatalog();
  const subscription = catalog.businesses.find((b) => b.tenantId === tenantId) ?? null;

  const admin = getSupabaseAdmin();
  const { data: tenantExtra } = await admin
    .from("tenants")
    .select("beta_notes, on_demand_usage_enabled, wallet_balance_kes, telecom_wallet_balance_kes, ai_wallet_balance_usd, is_active")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantExtra) {
    row.wallet_balance_kes = resolveWalletBalanceKes({
      walletKes: tenantExtra.wallet_balance_kes,
      telecomKes: tenantExtra.telecom_wallet_balance_kes,
      aiUsd: tenantExtra.ai_wallet_balance_usd,
    });
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
    ledgerRepairEnabled: process.env.ADMIN_LEDGER_REPAIR === "1",
  };
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

export async function waiveTenantOverage(opts: {
  businessId: string;
  note: string;
  actor?: string;
  idempotencyKey?: string;
}): Promise<{ wallet_balance_kes: number; waived_kes: number }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("waive_tenant_overage", {
    p_tenant_id: opts.businessId,
    p_note: opts.note,
    p_actor: opts.actor || "ops",
    p_idempotency_key: opts.idempotencyKey || null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    wallet_balance_kes: Number(row?.wallet_balance_kes ?? 0),
    waived_kes: Number(row?.waived_kes ?? 0),
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

function auditSummary(row: OpsAuditRow): string {
  const note = row.detail?.note;
  if (typeof note === "string" && note.trim()) return note.trim();
  if (row.action === "grant_package_minutes") {
    const m = row.detail?.minutes_granted;
    return typeof m === "number" ? `Granted ${m} minutes` : "Granted minutes";
  }
  if (row.action === "waive_overage") return "Waived on-demand overage";
  if (row.action === "set_billing_mode") {
    const mode = row.detail?.mode;
    return typeof mode === "string" ? `Charging mode → ${mode}` : "Charging mode change";
  }
  if (row.action === "adjust_wallet") return "Ledger adjustment";
  return row.action.replace(/_/g, " ");
}

export async function loadBillingHistory(tenantId: string): Promise<BillingHistoryEntry[]> {
  const [ledger, audit] = await Promise.all([
    listTenantLedger(tenantId, 40),
    listOpsAuditLog(tenantId, 40),
  ]);

  const fromLedger: BillingHistoryEntry[] = ledger.map((row: WalletLedgerRow) => ({
    id: `ledger:${row.id}`,
    created_at: row.created_at,
    kind: row.kind,
    summary: row.note?.trim() || row.kind.replace(/_/g, " "),
    amount_kes: row.amount_kes,
  }));

  const fromAudit: BillingHistoryEntry[] = audit.map((row) => ({
    id: `audit:${row.id}`,
    created_at: row.created_at,
    kind: row.action,
    summary: auditSummary(row),
    amount_kes: row.amount_kes,
  }));

  return [...fromLedger, ...fromAudit]
    .toSorted((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 60);
}

export { setTenantBillingMode, adjustTenantWalletSecure };
