import { getSupabaseAdmin } from "@/lib/supabase";
import { listDidPool, listPendingTenants, type DidPoolRow, type PendingTenant } from "@/lib/didPool";

export type AdminBusiness = {
  id: string;
  created_at: string;
  business_name: string;
  sautikit_virtual_number: string;
  whatsapp_notification_number: string;
  is_active: boolean | null;
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
  const { data, error } = await admin
    .from("tenants")
    .select(
      "id, created_at, business_name, sautikit_virtual_number, whatsapp_notification_number, is_active"
    )
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    status: businessStatus(row),
  })) as AdminBusiness[];
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
