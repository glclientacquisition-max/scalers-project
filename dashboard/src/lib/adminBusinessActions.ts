import { bustTenantCache } from "@/lib/tenantCache";
import { recordAdminAction } from "@/lib/adminAudit";
import {
  AdminActionBlocked,
  businessLifecycle,
  releaseBlockReason,
  requireReason,
} from "@/lib/adminBusinessModel";
import { setTenantBillingMode } from "@/lib/adminWallets";
import { adminErrorParts } from "@/lib/adminErrors";
import { normalizeE164 } from "@/lib/didPool";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Server side of the Super Admin safety and lifecycle rules:
 * - release refuses a number that is live on an active business;
 * - Suspend / Restore line pause and resume calls (line_status), nothing else changes;
 * - Archive / Unarchive: closed, hidden, billing stopped, owner sign-in blocked;
 * - no hard delete here. The nightly purge removes data after ARCHIVE_RESTORE_DAYS.
 * Every lifecycle action needs a typed reason and records the signed-in operator
 * in ops_audit_log.
 */

type BusinessRow = {
  id: string;
  business_name: string | null;
  sautikit_virtual_number: string | null;
  is_active: boolean | null;
  archived_at?: string | null;
  line_status?: string | null;
  suspended_at?: string | null;
  billing_enforcement?: string | null;
};

/**
 * archived_at / archived_by arrive with docs/supabase/admin_business_archive.sql,
 * suspended_at with admin_business_suspend.sql. Until then, fall back.
 */
export function isMissingArchiveColumn(err: unknown): boolean {
  const { message, code } = adminErrorParts(err);
  return code === "42703" || code === "PGRST204" || /archived_(at|by)|suspended_(at|by)/i.test(message);
}

const LOAD_SELECTS = [
  "id, business_name, sautikit_virtual_number, is_active, billing_enforcement, line_status, archived_at, suspended_at",
  "id, business_name, sautikit_virtual_number, is_active, billing_enforcement, line_status, archived_at",
  "id, business_name, sautikit_virtual_number, is_active",
];

async function loadBusiness(businessId: string): Promise<BusinessRow | null> {
  const admin = getSupabaseAdmin();
  let lastError: unknown = null;
  for (const columns of LOAD_SELECTS) {
    const res = await admin.from("tenants").select(columns).eq("id", businessId).maybeSingle();
    if (!res.error) return (res.data as unknown as BusinessRow | null) || null;
    lastError = res.error;
    // Older schemas: drop the newer columns and try again. Anything else is a real error.
    if (!isMissingArchiveColumn(res.error) && !/line_status|billing_enforcement/i.test(adminErrorParts(res.error).message)) break;
  }
  throw lastError;
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
  await recordAdminAction({ actor, action: "release_number", businessId, before: { number: e164 }, after: { number: null }, detail: { e164 } });
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
    before: { number: e164, business: business?.id || null },
    after: { number: e164, business: null, pool: "available" },
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
  bustTenantCache(businessId);
  if (!first.error) return true;
  if (!isMissingArchiveColumn(first.error)) throw first.error;
  const second = await admin.from("tenants").update(base).eq("id", businessId);
  bustTenantCache(businessId);
  if (second.error) throw second.error;
  return false;
}

function lifecycleOf(business: BusinessRow) {
  return businessLifecycle({
    isActive: business.is_active,
    archivedAt: business.archived_at,
    lineStatus: business.line_status,
    suspendedAt: business.suspended_at,
  });
}

async function loadExisting(businessId: string): Promise<BusinessRow> {
  const business = await loadBusiness(businessId);
  if (!business) throw new AdminActionBlocked("This business no longer exists.");
  return business;
}

/**
 * Suspend: callers hear "line unavailable" (voice gate #651 reads line_status).
 * The gate answers before any call row, so a refused call is never metered or charged.
 * Data, package, minutes and billing mode stay as they are.
 */
export async function suspendBusiness(businessId: string, actor: string, rawReason: unknown) {
  const reason = requireReason(rawReason);
  const business = await loadExisting(businessId);
  const state = lifecycleOf(business);
  if (state.state === "archived") throw new AdminActionBlocked("Archived businesses are already closed.");
  if (state.state === "suspended") throw new AdminActionBlocked("Already suspended.");
  const { error } = await getSupabaseAdmin().rpc("admin_set_business_suspended", {
    p_tenant_id: businessId,
    p_suspended: true,
    p_actor: actor,
  });
  bustTenantCache(businessId);
  if (error) throw error;
  await recordAdminAction({
    actor,
    action: "suspend_business",
    businessId,
    reason,
    before: { line: business.line_status || "active" },
    after: { line: "suspended" },
  });
}

/** Restore a line an admin suspended. A non-payment suspension is lifted by billing, not here. */
export async function unsuspendBusiness(businessId: string, actor: string, rawReason: unknown) {
  const reason = requireReason(rawReason);
  const business = await loadExisting(businessId);
  const state = lifecycleOf(business);
  if (state.state !== "suspended") throw new AdminActionBlocked("This line is not suspended.");
  if (!state.byAdmin) {
    throw new AdminActionBlocked("Suspended for non-payment. It comes back when the bill is paid.");
  }
  const { data, error } = await getSupabaseAdmin().rpc("admin_set_business_suspended", {
    p_tenant_id: businessId,
    p_suspended: false,
    p_actor: actor,
  });
  bustTenantCache(businessId);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  await recordAdminAction({
    actor,
    action: "unsuspend_business",
    businessId,
    reason,
    before: { line: "suspended", suspended_at: business.suspended_at || null },
    after: { line: (row as { line_status?: string } | null)?.line_status || "active" },
  });
}

/**
 * Billing stop on archive. Uses the Admin's existing "stop charging" (billing mode off),
 * which writes its own ops_audit_log row. Restore does not switch charging back on.
 *
 * TODO(ops-billing): when packages + on-demand billing lands, also
 *  - skip archived businesses in package period renewal and invoice runs;
 *  - turn on-demand off and void or hold open invoices;
 *  - stop line rental (refresh_line_status / apply_line_rental) for archived rows.
 * Swap this body for that one call; the archive flow already calls it.
 */
export async function stopBillingForArchive(business: BusinessRow, actor: string, reason: string) {
  const before = business.billing_enforcement || "off";
  if (before === "off") return { before, after: "off", changed: false };
  await setTenantBillingMode({ businessId: business.id, mode: "off", note: `Archived: ${reason}`, actor });
  return { before, after: "off", changed: true };
}

/** Archive: closed, hidden from default lists, billing stopped, owner sign-in blocked. Number kept. */
export async function archiveBusiness(businessId: string, actor: string, rawReason: unknown) {
  const reason = requireReason(rawReason);
  const business = await loadExisting(businessId);
  if (lifecycleOf(business).state === "archived") throw new AdminActionBlocked("Already archived.");
  const archivedAt = new Date().toISOString();
  const dated = await updateTenant(
    businessId,
    { archived_at: archivedAt, archived_by: actor },
    { is_active: false },
  );
  const billing = await stopBillingForArchive(business, actor, reason);
  await recordAdminAction({
    actor,
    action: "archive_business",
    businessId,
    reason,
    before: { active: true, billing: billing.before },
    after: { active: false, archive_date_saved: dated, billing: billing.after },
    detail: { dated, archived_at: dated ? archivedAt : null },
  });
  return { dated, billingStopped: billing.changed };
}

/** Unarchive: back on the lists and the line opens. Charging stays off until someone turns it on. */
export async function restoreBusiness(businessId: string, actor: string, rawReason: unknown) {
  const reason = requireReason(rawReason);
  const business = await loadExisting(businessId);
  if (lifecycleOf(business).state !== "archived") throw new AdminActionBlocked("This business is not archived.");
  await updateTenant(businessId, { archived_at: null, archived_by: null }, { is_active: true });
  await recordAdminAction({
    actor,
    action: "restore_business",
    businessId,
    reason,
    before: { active: false, archived_at: business.archived_at || null },
    after: { active: true },
  });
}
