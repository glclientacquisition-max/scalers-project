import { getSupabaseAdmin } from "@/lib/supabase";
import type { WalletLedgerRow } from "@/lib/wallet";

export type BillingMode = "off" | "soft" | "hard";

export type AdminWalletRow = {
  id: string;
  business_name: string;
  sautikit_virtual_number: string;
  is_active: boolean | null;
  billing_enforcement: BillingMode;
};

export type AdminWalletOverview = {
  rows: AdminWalletRow[];
  betaCount: number;
  chargingCount: number;
};

function modeOf(v: string | null | undefined): BillingMode {
  if (v === "soft" || v === "hard" || v === "off") return v;
  return "off";
}

export async function listAdminWallets(): Promise<AdminWalletOverview> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("tenants")
    .select(
      "id, business_name, sautikit_virtual_number, is_active, billing_enforcement"
    )
    .order("business_name", { ascending: true });

  if (error) throw error;

  const rows: AdminWalletRow[] = (data || []).map((raw) => ({
    id: raw.id as string,
    business_name: raw.business_name as string,
    sautikit_virtual_number: raw.sautikit_virtual_number as string,
    is_active: raw.is_active as boolean | null,
    billing_enforcement: modeOf(raw.billing_enforcement),
  }));

  return {
    rows,
    betaCount: rows.filter((r) => r.billing_enforcement === "off" && r.is_active !== false).length,
    chargingCount: rows.filter((r) => r.billing_enforcement !== "off" && r.is_active !== false)
      .length,
  };
}

export async function setTenantBillingMode(opts: {
  businessId: string;
  mode: BillingMode;
  note: string;
  actor?: string;
  betaExpiresAt?: string | null;
}): Promise<{ billing_enforcement: BillingMode }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("set_tenant_billing_mode", {
    p_tenant_id: opts.businessId,
    p_mode: opts.mode,
    p_actor: opts.actor || "ops",
    p_note: opts.note,
    p_beta_expires_at: opts.betaExpiresAt || null,
    p_waive_negative_balance: false,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    billing_enforcement: modeOf(row?.billing_enforcement),
  };
}

export async function listTenantLedger(
  tenantId: string,
  limit = 30
): Promise<WalletLedgerRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("wallet_ledger")
    .select("id, created_at, kind, amount_kes, balance_after_kes, note, reference_type, reference_id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    kind: row.kind,
    amount_kes: Number(row.amount_kes),
    balance_after_kes: Number(row.balance_after_kes),
    note: row.note ?? null,
    reference_type: row.reference_type ?? null,
    reference_id: row.reference_id ?? null,
  }));
}
