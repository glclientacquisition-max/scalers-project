import { recordAdminAction } from "@/lib/adminAudit";
import {
  AdminActionBlocked,
  archiveState,
  releaseBlockReason,
} from "@/lib/adminBusinessModel";
import { adminErrorParts } from "@/lib/adminErrors";
import { normalizeE164 } from "@/lib/didPool";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Server side of the Super Admin safety rules (A0):
 * - release refuses a number that is live on an active business;
 * - Remove became Archive / Restore, and permanent delete only after the grace period.
 * Every action records the signed-in operator in ops_audit_log (best effort).
 */

type BusinessRow = {
  id: string;
  business_name: string | null;
  sautikit_virtual_number: string | null;
  is_active: boolean | null;
  archived_at?: string | null;
};

/** archived_at / archived_by arrive with docs/supabase/admin_business_archive.sql. Until then, fall back. */
export function isMissingArchiveColumn(err: unknown): boolean {
  const { message, code } = adminErrorParts(err);
  return code === "42703" || code === "PGRST204" || /archived_(at|by)/i.test(message);
}

async function loadBusiness(businessId: string): Promise<BusinessRow | null> {
  const admin = getSupabaseAdmin();
  let res = await admin
    .from("tenants")
    .select("id, business_name, sautikit_virtual_number, is_active, archived_at")
    .eq("id", businessId)
    .maybeSingle();
  if (res.error && isMissingArchiveColumn(res.error)) {
    res = await admin
      .from("tenants")
      .select("id, business_name, sautikit_virtual_number, is_active")
      .eq("id", businessId)
      .maybeSingle();
  }
  if (res.error) throw res.error;
  return (res.data as BusinessRow | null) || null;
}

function assertReleasable(business: BusinessRow | null) {
  const reason = releaseBlockReason({
    linked: Boolean(business),
    businessName: business?.business_name,
    isActive: business?.is_active,
  });
  if (reason) throw new AdminActionBlocked(reason);
}

/** Release the number on a business. Blocked while the business is active. */
export async function releaseBusinessNumber(businessId: string, actor: string): Promise<string | null> {
  const business = await loadBusiness(businessId);
  if (!business) throw new AdminActionBlocked("This business no longer exists.");
  assertReleasable(business);
  const { data, error } = await getSupabaseAdmin().rpc("release_did_from_business", {
    p_tenant_id: businessId,
  });
  if (error) throw error;
  const e164 = (data as string) || null;
  await recordAdminAction({ actor, action: "release_number", businessId, detail: { e164 } });
  return e164;
}

/** Release a pool number from the Numbers screen. Same rule as above. */
export async function releasePoolNumber(
  rawE164: string,
  actor: string,
): Promise<{ e164: string; releasedBusiness: boolean }> {
  const e164 = normalizeE164(rawE164);
  if (!e164) throw new AdminActionBlocked("Enter a Kenyan number.");
  const admin = getSupabaseAdmin();
  const { data: row, error } = await admin
    .from("sautikit_did_pool")
    .select("id, e164, status, tenant_id")
    .eq("e164", e164)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new AdminActionBlocked("This number is not in the pool.");
  if (row.status === "available") return { e164, releasedBusiness: false };
  if (row.status === "disabled") throw new AdminActionBlocked("This number is disabled.");

  const business = row.tenant_id ? await loadBusiness(String(row.tenant_id)) : null;
  assertReleasable(business);

  if (business) {
    const { error: rpcError } = await admin.rpc("release_did_from_business", { p_tenant_id: business.id });
    if (rpcError) throw rpcError;
  } else {
    const { error: updateError } = await admin
      .from("sautikit_did_pool")
      .update({ status: "available", tenant_id: null, assigned_at: null })
      .eq("id", row.id);
    if (updateError) throw updateError;
  }
  await recordAdminAction({
    actor,
    action: "release_number",
    businessId: business?.id || null,
    detail: { e164 },
  });
  return { e164, releasedBusiness: Boolean(business) };
}

async function updateTenant(
  businessId: string,
  withColumns: Record<string, unknown>,
  base: Record<string, unknown>,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const first = await admin.from("tenants").update({ ...base, ...withColumns }).eq("id", businessId);
  if (!first.error) return true;
  if (!isMissingArchiveColumn(first.error)) throw first.error;
  const second = await admin.from("tenants").update(base).eq("id", businessId);
  if (second.error) throw second.error;
  return false;
}

/** Archive: hidden from active lists, number kept, reversible. Starts the delete grace period. */
export async function archiveBusiness(businessId: string, actor: string, reason: string) {
  const business = await loadBusiness(businessId);
  if (!business) throw new AdminActionBlocked("This business no longer exists.");
  if (business.is_active === false) throw new AdminActionBlocked("Already archived.");
  const dated = await updateTenant(
    businessId,
    { archived_at: new Date().toISOString(), archived_by: actor },
    { is_active: false },
  );
  await recordAdminAction({ actor, action: "archive_business", businessId, detail: { reason, dated } });
  return { dated };
}

export async function restoreBusiness(businessId: string, actor: string) {
  const business = await loadBusiness(businessId);
  if (!business) throw new AdminActionBlocked("This business no longer exists.");
  if (business.is_active !== false) throw new AdminActionBlocked("This business is not archived.");
  await updateTenant(businessId, { archived_at: null, archived_by: null }, { is_active: true });
  await recordAdminAction({ actor, action: "restore_business", businessId });
}

/**
 * Permanent delete. Only for a business archived at least ARCHIVE_GRACE_DAYS ago,
 * and only when the operator retypes the business name.
 */
export async function deleteArchivedBusiness(businessId: string, actor: string, typedName: string) {
  const business = await loadBusiness(businessId);
  if (!business) throw new AdminActionBlocked("This business no longer exists.");
  const state = archiveState({ isActive: business.is_active, archivedAt: business.archived_at });
  if (!state.canDelete) throw new AdminActionBlocked(state.deleteBlockedReason || "Permanent delete is off.");
  const name = String(business.business_name || "").trim();
  if (!name || typedName.trim() !== name) {
    throw new AdminActionBlocked("Type the business name exactly to delete it.");
  }
  // Write the audit row first: the tenant row (and its FK) is gone after the RPC.
  await recordAdminAction({
    actor,
    action: "delete_business",
    businessId,
    detail: { business_name: name, archived_at: business.archived_at || null },
  });
  const { data, error } = await getSupabaseAdmin().rpc("remove_business_and_release_did", {
    p_tenant_id: businessId,
  });
  if (error) throw error;
  return (data as string) || null;
}
