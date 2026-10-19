import { getSupabaseAdmin } from "@/lib/supabase";
import { pendingFromBusinesses } from "@/lib/adminWaitingModel";
import { listDidPool, type DidPoolRow, type PendingTenant } from "@/lib/didPool";
import { loadBusinessPackageNames } from "@/lib/packageCatalog";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { businessLifecycle, preArchiveFromAudit, type PreArchiveBilling } from "@/lib/adminBusinessModel";

export type AdminBusiness = {
  id: string;
  created_at: string;
  business_name: string;
  sautikit_virtual_number: string;
  whatsapp_notification_number: string;
  is_active: boolean | null;
  /** When the business was archived. null before docs/supabase/admin_business_archive.sql or when never archived. */
  archived_at: string | null;
  /** tenants.line_status: active | grace | suspended. "active" before line_rental_grace.sql. */
  line_status: string;
  /** Set when a Super Admin suspended the line (admin_business_suspend.sql). null for non-payment. */
  suspended_at: string | null;
  package_name: string | null;
  package_period: "month" | "year" | null;
  billing_enforcement: "off" | "soft" | "hard";
  status: "active" | "waiting" | "suspended" | "archived";
  /** Archived only: charging right before archive, for the Unarchive "as before" choice. */
  pre_archive: PreArchiveBilling | null;
};

/**
 * Pre-archive charging per business from ops_audit_log (newest archive row wins).
 * Best effort: a missing table or failed read just means no "as before" offer.
 */
export async function loadPreArchiveBilling(tenantIds: string[]): Promise<Map<string, PreArchiveBilling>> {
  const out = new Map<string, PreArchiveBilling>();
  if (!tenantIds.length) return out;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("ops_audit_log")
      .select("tenant_id, action, detail, created_at")
      .in("tenant_id", tenantIds)
      .in("action", ["archive_tenant_billing", "archive_business"])
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !data) return out;
    const byTenant = new Map<string, Array<{ action?: string | null; detail?: unknown }>>();
    for (const row of data as Array<{ tenant_id: string; action: string; detail: unknown }>) {
      const list = byTenant.get(String(row.tenant_id)) || [];
      list.push(row);
      byTenant.set(String(row.tenant_id), list);
    }
    for (const [id, rows] of byTenant) {
      const pre = preArchiveFromAudit(rows);
      if (pre) out.set(id, pre);
    }
  } catch {
    // No offer is the safe default.
  }
  return out;
}

export type AdminOverview = {
  totalBusinesses: number;
  activeBusinesses: number;
  waitingForNumber: number;
  withoutPackage: number;
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
  archived_at?: string | null;
  line_status?: string | null;
  suspended_at?: string | null;
}): AdminBusiness["status"] {
  const life = businessLifecycle({
    isActive: row.is_active,
    archivedAt: row.archived_at,
    lineStatus: row.line_status,
    suspendedAt: row.suspended_at,
  });
  if (life.state === "archived") return "archived";
  if (life.state === "suspended") return "suspended";
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
    billing_enforcement?: string | null;
    archived_at?: string | null;
    line_status?: string | null;
    suspended_at?: string | null;
  };

  const BASE =
    "id, created_at, business_name, sautikit_virtual_number, whatsapp_notification_number, is_active";
  // Optional columns, newest first. Each one drops out if the database does not have it yet.
  let optional = ["billing_enforcement", "archived_at", "line_status", "suspended_at"];
  let data: BusinessRow[] | null = null;
  let error: { message: string } | null = null;

  for (;;) {
    const res = await admin
      .from("tenants")
      .select([BASE, ...optional].join(", "))
      .order("created_at", { ascending: true });
    data = (res.data as unknown as BusinessRow[] | null) || null;
    error = res.error;
    if (!error) break;
    const missing = optional.find((col) => new RegExp(col, "i").test(error?.message || ""));
    if (!missing) break;
    optional = optional.filter((col) => col !== missing);
  }

  if (error) throw error;
  const packages = await loadBusinessPackageNames();
  const archivedIds = (data || []).filter((row) => businessStatus(row) === "archived").map((row) => String(row.id));
  const preArchive = await loadPreArchiveBilling(archivedIds);
  return (data || []).map((row) => {
    const pack = packages.get(String(row.id));
    return {
      ...row,
      archived_at: row.archived_at || null,
      line_status: row.line_status || "active",
      suspended_at: row.suspended_at || null,
      package_name: pack?.packageName || null,
      package_period: pack?.period || null,
      billing_enforcement:
        row.billing_enforcement === "soft" || row.billing_enforcement === "hard"
          ? row.billing_enforcement
          : "off",
      status: businessStatus(row),
      pre_archive: preArchive.get(String(row.id)) || null,
    } as AdminBusiness;
  });
}

export async function getAdminOverview(): Promise<AdminOverview> {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [businesses, pool, callsRes] = await Promise.all([
    listBusinesses(),
    listDidPool(),
    admin
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since.toISOString()),
  ]);

  if (callsRes.error) throw callsRes.error;

  const pendingBusinesses = pendingFromBusinesses(businesses);

  return {
    totalBusinesses: businesses.length,
    activeBusinesses: businesses.filter((b) => b.status === "active").length,
    waitingForNumber: businesses.filter((b) => b.status === "waiting").length,
    withoutPackage: businesses.filter((b) => b.status !== "archived" && !b.package_name).length,
    availableDids: pool.filter((p) => p.status === "available").length,
    assignedDids: pool.filter((p) => p.status === "assigned").length,
    callsLast7Days: callsRes.count || 0,
    pool,
    pendingBusinesses,
    businesses,
    attention: businesses.filter(
      (b) => b.status === "waiting" || (b.status === "active" && !b.package_name),
    ),
  };
}

export async function getAdminBusinessById(id: string): Promise<{
  business: AdminBusiness;
  availableDids: { e164: string }[];
} | null> {
  await requireSuperAdmin();
  const [businesses, pool] = await Promise.all([listBusinesses(), listDidPool()]);
  const business = businesses.find((row) => row.id === id);
  if (!business) return null;
  const availableDids = pool.filter((row) => row.status === "available").map((row) => ({ e164: row.e164 }));
  return { business, availableDids };
}
