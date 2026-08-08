import { getSupabaseAdmin } from "@/lib/supabase";
import { listDidPool, listPendingTenants, type DidPoolRow, type PendingTenant } from "@/lib/didPool";
import { resolveWalletBalanceKes } from "@/lib/wallet";

export type AdminBusiness = {
  id: string;
  created_at: string;
  business_name: string;
  sautikit_virtual_number: string;
  whatsapp_notification_number: string;
  is_active: boolean | null;
  wallet_balance_kes: number | null;
  /** @deprecated */
  telecom_wallet_balance_kes: number | null;
  /** @deprecated */
  ai_wallet_balance_usd: number | null;
  status: "active" | "waiting" | "archived";
};

export type AdminOverview = {
  totalBusinesses: number;
  activeBusinesses: number;
  waitingForNumber: number;
  availableDids: number;
  assignedDids: number;
  callsLast7Days: number;
  pool: DidPoolRow[];
  pendingBusinesses: PendingTenant[];
  businesses: AdminBusiness[];
  attention: AdminBusiness[];
};

function businessStatus(row: {
  is_active: boolean | null;
  sautikit_virtual_number: string;
}): AdminBusiness["status"] {
  if (row.is_active === false) return "archived";
  if (String(row.sautikit_virtual_number || "").startsWith("pending:")) return "waiting";
  return "active";
}

export async function listBusinesses(): Promise<AdminBusiness[]> {
  const admin = getSupabaseAdmin();
  type BusinessRow = {
    id: string;
    created_at: string;
    business_name: string;
    sautikit_virtual_number: string;
    whatsapp_notification_number: string;
    is_active: boolean | null;
    wallet_balance_kes?: number | null;
    telecom_wallet_balance_kes?: number | null;
    ai_wallet_balance_usd?: number | null;
  };

  let data: BusinessRow[] | null = null;
  let error: { message: string } | null = null;

  {
    const res = await admin
      .from("tenants")
      .select(
        "id, created_at, business_name, sautikit_virtual_number, whatsapp_notification_number, is_active, wallet_balance_kes, telecom_wallet_balance_kes, ai_wallet_balance_usd"
      )
      .order("created_at", { ascending: true });
    data = (res.data as BusinessRow[] | null) || null;
    error = res.error;
  }

  if (error && /wallet_balance_kes/i.test(error.message)) {
    const res = await admin
      .from("tenants")
      .select(
        "id, created_at, business_name, sautikit_virtual_number, whatsapp_notification_number, is_active, telecom_wallet_balance_kes, ai_wallet_balance_usd"
      )
      .order("created_at", { ascending: true });
    data = (res.data as BusinessRow[] | null) || null;
    error = res.error;
  }

  if (error) throw error;
  return (data || []).map((row) => {
    const wallet = resolveWalletBalanceKes({
      walletKes: row.wallet_balance_kes,
      telecomKes: row.telecom_wallet_balance_kes,
      aiUsd: row.ai_wallet_balance_usd,
    });
    return {
      ...row,
      wallet_balance_kes: wallet,
      telecom_wallet_balance_kes: wallet,
      ai_wallet_balance_usd: 0,
      status: businessStatus(row),
    } as AdminBusiness;
  });
}

export async function adjustTenantWallet(opts: {
  businessId: string;
  deltaKes: number;
  note?: string;
}): Promise<{ wallet_balance_kes: number }> {
  const admin = getSupabaseAdmin();

  // Prefer one-arg KES RPC; fall back to legacy dual-delta signature.
  const primary = await admin.rpc("adjust_tenant_wallet", {
    p_tenant_id: opts.businessId,
    p_delta_kes: opts.deltaKes,
    p_note: opts.note || null,
  });

  if (!primary.error) {
    const row = Array.isArray(primary.data) ? primary.data[0] : primary.data;
    return { wallet_balance_kes: Number(row?.wallet_balance_kes ?? 0) };
  }

  const legacy = await admin.rpc("adjust_tenant_wallet", {
    p_tenant_id: opts.businessId,
    p_telecom_delta_kes: opts.deltaKes,
    p_ai_delta_usd: 0,
    p_note: opts.note || null,
  });
  if (legacy.error) throw primary.error || legacy.error;
  const row = Array.isArray(legacy.data) ? legacy.data[0] : legacy.data;
  return {
    wallet_balance_kes: Number(
      row?.wallet_balance_kes ?? row?.telecom_wallet_balance_kes ?? 0
    ),
  };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const admin = getSupabaseAdmin();
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [businesses, pool, pendingBusinesses, callsRes] = await Promise.all([
    listBusinesses(),
    listDidPool(),
    listPendingTenants(),
    admin
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since.toISOString()),
  ]);

  if (callsRes.error) throw callsRes.error;

  return {
    totalBusinesses: businesses.length,
    activeBusinesses: businesses.filter((b) => b.status === "active").length,
    waitingForNumber: businesses.filter((b) => b.status === "waiting").length,
    availableDids: pool.filter((p) => p.status === "available").length,
    assignedDids: pool.filter((p) => p.status === "assigned").length,
    callsLast7Days: callsRes.count || 0,
    pool,
    pendingBusinesses,
    businesses,
    attention: businesses.filter((b) => b.status === "waiting" || b.status === "archived"),
  };
}

export async function releaseDidFromBusiness(businessId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("release_did_from_business", {
    p_tenant_id: businessId,
  });
  if (error) throw error;
  return (data as string) || null;
}

export async function removeBusinessAndReleaseDid(businessId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("remove_business_and_release_did", {
    p_tenant_id: businessId,
  });
  if (error) throw error;
  return (data as string) || null;
}
