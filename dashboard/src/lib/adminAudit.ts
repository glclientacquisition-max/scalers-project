import { logAdminError } from "@/lib/adminErrors";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * One ops_audit_log row for an admin write: who (signed-in operator), what (action),
 * which business, before and after, and why. created_at is when.
 * Best effort: a missing table or a failed insert is logged and never blocks the action.
 * Billing RPCs (grant minutes, billing mode) write their own row inside the same transaction.
 */
export async function recordAdminAction(entry: {
  actor: string;
  action: string;
  businessId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const detail: Record<string, unknown> = { ...(entry.detail || {}) };
  if (entry.before !== undefined) detail.before = entry.before;
  if (entry.after !== undefined) detail.after = entry.after;
  if (entry.reason) detail.reason = entry.reason;
  try {
    const { error } = await getSupabaseAdmin()
      .from("ops_audit_log")
      .insert({
        actor: entry.actor,
        action: entry.action,
        tenant_id: entry.businessId || null,
        detail,
      });
    if (error) logAdminError("audit", error);
  } catch (err) {
    logAdminError("audit", err);
  }
}
