import { bustTenantCache } from "@/lib/tenantCache";
import { recordAdminAction } from "@/lib/adminAudit";
import {
  AdminActionBlocked,
  businessLifecycle,
  releaseBlockReason,
  requireReason,
} from "@/lib/adminBusinessModel";
import { confirmTenantBillingMode, setTenantBillingMode } from "@/lib/adminWallets";
import { adminErrorParts } from "@/lib/adminErrors";
import { normalizeE164 } from "@/lib/didPool";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadPreArchiveBilling } from "@/lib/admin";

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
  if (row.status === "available" || row.status === "quarantine") return { e164, releasedBusiness: false };
  if (row.status === "disabled") throw new AdminActionBlocked("This number is disabled.");

  const business = row.tenant_id ? await loadBusiness(String(row.tenant_id)) : null;
  assertReleasable(business);

  if (business) {
    const { error: rpcError } = await admin.rpc("release_did_from_business", { p_tenant_id: business.id });
    if (rpcError) throw rpcError;
  } else {
    const { error: rpcError } = await admin.rpc("quarantine_pool_number", {
      p_e164: e164,
      p_actor: actor,
      p_reason: "pool release",
    });
    if (rpcError) throw rpcError;
  }
  await recordAdminAction({
    actor,
    action: "release_number",
    businessId: business?.id || null,
    before: { number: e164, business: business?.id || null },
    after: { number: e164, business: null, pool: "quarantine" },
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

/** PostgREST / Postgres "function not found": the billing SQL is not applied on this project yet. */
export function isMissingBillingRpc(err: unknown): boolean {
  const { message, code } = adminErrorParts(err);
  return (
    code === "PGRST202" ||
    code === "42883" ||
    (/(archive|unarchive)_tenant_billing/i.test(message) && /could not find|does not exist/i.test(message))
  );
}

/**
 * Billing stop on archive: one audited, idempotent SQL call
 * (docs/supabase/archive_tenant_billing.sql, archive_tenant_billing). It turns
 * billing mode and on-demand off, stops line rental, keeps the period rollover
 * from renewing the package while archived, and writes one ops_audit_log row
 * with the settings from before. No invoice table exists yet; the SQL documents
 * that hook. While archived, a trigger refuses turning charging back on.
 *
 * Until that file is applied, fall back to the Admin's "stop charging"
 * (billing mode off), which writes its own ops_audit_log row.
 */
export async function stopBillingForArchive(
  business: BusinessRow,
  actor: string,
  reason: string,
  archiveDated = true,
) {
  const before = business.billing_enforcement || "off";
  // Without an archive date (older schema) the SQL refuses, so go straight to the fallback.
  if (archiveDated) {
    const { data, error } = await getSupabaseAdmin().rpc("archive_tenant_billing", {
      p_tenant_id: business.id,
      p_actor: actor,
      p_reason: reason,
    });
    bustTenantCache(business.id);
    if (!error) {
      const row = (Array.isArray(data) ? data[0] : data) as
        | { changed?: boolean; billing_before?: string; billing_after?: string }
        | null;
      return {
        before: row?.billing_before || before,
        after: row?.billing_after || "off",
        changed: Boolean(row?.changed),
      };
    }
    if (!isMissingBillingRpc(error)) throw error;
  }
  if (before === "off") return { before, after: "off", changed: false };
  await setTenantBillingMode({ businessId: business.id, mode: "off", note: `Archived: ${reason}`, actor });
  return { before, after: "off", changed: true };
}

/**
 * Billing after unarchive (unarchive_tenant_billing): records it and reports the
 * pre-archive settings. It turns nothing back on. Billing mode and on-demand stay
 * off until an admin chooses. Missing SQL means there is nothing to resume.
 */
export async function resumeBillingAfterUnarchive(businessId: string, actor: string, reason: string) {
  const { data, error } = await getSupabaseAdmin().rpc("unarchive_tenant_billing", {
    p_tenant_id: businessId,
    p_actor: actor,
    p_reason: reason,
  });
  if (error) {
    if (isMissingBillingRpc(error)) return null;
    throw error;
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { billing_enforcement?: string; pre_archive_billing?: string | null; pre_archive_on_demand?: boolean | null }
    | null;
  return {
    billing: row?.billing_enforcement || "off",
    preArchiveBilling: row?.pre_archive_billing ?? null,
    preArchiveOnDemand: row?.pre_archive_on_demand ?? null,
  };
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
  const billing = await stopBillingForArchive(business, actor, reason, dated);
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
/**
 * Unarchive: back on the list, owner can sign in, line opens. Charging stays off unless the
 * admin explicitly chose "back on as before" (resumeBilling, default false). The choice and
 * what was turned on are recorded in the restore_business audit row.
 */
export async function restoreBusiness(
  businessId: string,
  actor: string,
  rawReason: unknown,
  resumeBilling = false,
) {
  const reason = requireReason(rawReason);
  const business = await loadExisting(businessId);
  if (lifecycleOf(business).state !== "archived") throw new AdminActionBlocked("This business is not archived.");
  await updateTenant(businessId, { archived_at: null, archived_by: null }, { is_active: true });
  const billing = await resumeBillingAfterUnarchive(businessId, actor, reason);

  // Pre-archive settings: from unarchive_tenant_billing, else from the archive audit row.
  let pre: { billing: string | null; onDemand: boolean | null } | null = billing
    ? { billing: billing.preArchiveBilling, onDemand: billing.preArchiveOnDemand }
    : null;
  if (!pre?.billing) {
    const fromAudit = (await loadPreArchiveBilling([businessId])).get(businessId);
    if (fromAudit) pre = { billing: fromAudit.billing, onDemand: fromAudit.onDemand };
  }

  const resumed = { billing: billing?.billing || business.billing_enforcement || "off", on_demand: false };
  if (resumeBilling && pre) {
    if (pre.billing === "soft" || pre.billing === "hard") {
      const res = await confirmTenantBillingMode({
        businessId,
        mode: pre.billing,
        note: `Unarchived, back on as before: ${reason}`,
        actor,
      });
      resumed.billing = res.billing_enforcement;
    }
    if (pre.onDemand === true) {
      const { error } = await getSupabaseAdmin().rpc("set_tenant_on_demand_usage", {
        p_tenant_id: businessId,
        p_enabled: true,
      });
      if (error) throw error;
      resumed.on_demand = true;
    }
    bustTenantCache(businessId);
  }

  await recordAdminAction({
    actor,
    action: "restore_business",
    businessId,
    reason,
    before: { active: false, archived_at: business.archived_at || null },
    after: { active: true, billing: resumed.billing, on_demand: resumed.on_demand },
    detail: {
      resume_billing_choice: resumeBilling,
      pre_archive_billing: pre?.billing ?? null,
      pre_archive_on_demand: pre?.onDemand ?? null,
    },
  });
  return { billing: resumed.billing, onDemand: resumed.on_demand, resumeBilling };
}
