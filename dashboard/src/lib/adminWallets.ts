import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveWalletBalanceKes, WALLET_LOW_BALANCE_KES, type WalletLedgerRow } from "@/lib/wallet";

export type BillingMode = "off" | "soft" | "hard";

export type AdminWalletRow = {
  id: string;
  business_name: string;
  sautikit_virtual_number: string;
  is_active: boolean | null;
  wallet_balance_kes: number;
  billing_enforcement: BillingMode;
  beta_notes: string | null;
  beta_expires_at: string | null;
  wallet_status: "beta" | "ok" | "low" | "overdrawn" | "archived";
};

export type AdminWalletOverview = {
  rows: AdminWalletRow[];
  betaCount: number;
  prepaidCount: number;
  lowCount: number;
  overdrawnCount: number;
  totalFloatKes: number;
};

function modeOf(v: string | null | undefined): BillingMode {
  if (v === "soft" || v === "hard" || v === "off") return v;
  return "off";
}

function walletStatus(row: {
  is_active: boolean | null;
  billing_enforcement: BillingMode;
  wallet_balance_kes: number;
}): AdminWalletRow["wallet_status"] {
  if (row.is_active === false) return "archived";
  if (row.billing_enforcement === "off") return "beta";
  if (row.wallet_balance_kes < 0) return "overdrawn";
  if (row.wallet_balance_kes < WALLET_LOW_BALANCE_KES) return "low";
  return "ok";
}

export async function listAdminWallets(): Promise<AdminWalletOverview> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("tenants")
    .select(
      "id, business_name, sautikit_virtual_number, is_active, wallet_balance_kes, telecom_wallet_balance_kes, ai_wallet_balance_usd, billing_enforcement, beta_notes, beta_expires_at"
    )
    .order("business_name", { ascending: true });

  if (error) throw error;

  const rows: AdminWalletRow[] = (data || []).map((raw) => {
    const balance = resolveWalletBalanceKes({
      walletKes: raw.wallet_balance_kes,
      telecomKes: raw.telecom_wallet_balance_kes,
      aiUsd: raw.ai_wallet_balance_usd,
    });
    const billing_enforcement = modeOf(raw.billing_enforcement);
    const base = {
      id: raw.id as string,
      business_name: raw.business_name as string,
      sautikit_virtual_number: raw.sautikit_virtual_number as string,
      is_active: raw.is_active as boolean | null,
      wallet_balance_kes: balance,
      billing_enforcement,
      beta_notes: (raw.beta_notes as string | null) ?? null,
      beta_expires_at: (raw.beta_expires_at as string | null) ?? null,
    };
    return { ...base, wallet_status: walletStatus(base) };
  });

  return {
    rows,
    betaCount: rows.filter((r) => r.wallet_status === "beta").length,
    prepaidCount: rows.filter((r) => r.billing_enforcement !== "off" && r.wallet_status !== "archived")
      .length,
    lowCount: rows.filter((r) => r.wallet_status === "low").length,
    overdrawnCount: rows.filter((r) => r.wallet_status === "overdrawn").length,
    totalFloatKes: rows.reduce((sum, r) => sum + Math.max(0, r.wallet_balance_kes), 0),
  };
}

export async function adjustTenantWalletSecure(opts: {
  businessId: string;
  deltaKes: number;
  note: string;
  actor?: string;
  idempotencyKey?: string;
}): Promise<{ wallet_balance_kes: number }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("adjust_tenant_wallet", {
    p_tenant_id: opts.businessId,
    p_delta_kes: opts.deltaKes,
    p_note: opts.note,
    p_actor: opts.actor || "ops",
    p_idempotency_key: opts.idempotencyKey || null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { wallet_balance_kes: Number(row?.wallet_balance_kes ?? 0) };
}

export async function setTenantBillingMode(opts: {
  businessId: string;
  mode: BillingMode;
  note: string;
  actor?: string;
  waiveNegative?: boolean;
  betaExpiresAt?: string | null;
}): Promise<{ billing_enforcement: BillingMode; wallet_balance_kes: number }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("set_tenant_billing_mode", {
    p_tenant_id: opts.businessId,
    p_mode: opts.mode,
    p_actor: opts.actor || "ops",
    p_note: opts.note,
    p_beta_expires_at: opts.betaExpiresAt || null,
    p_waive_negative_balance: Boolean(opts.waiveNegative),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    billing_enforcement: modeOf(row?.billing_enforcement),
    wallet_balance_kes: Number(row?.wallet_balance_kes ?? 0),
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
