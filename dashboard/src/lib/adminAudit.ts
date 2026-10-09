import { logAdminError } from "@/lib/adminErrors";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * One ops_audit_log row for an admin action. Best effort: a missing table or a
 * failed insert is logged and never blocks the action itself.
 * A1 widens this to every admin write and adds the Activity screen.
 */
export async function recordAdminAction(entry: {
  actor: string;
  action: string;
  businessId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("ops_audit_log")
      .insert({
        actor: entry.actor,
        action: entry.action,
        tenant_id: entry.businessId || null,
        detail: entry.detail || {},
      });
    if (error) logAdminError("audit", error);
  } catch (err) {
    logAdminError("audit", err);
  }
}
