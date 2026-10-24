import "server-only";
import { recordAdminAction } from "@/lib/adminAudit";
import { sendOpsMail } from "@/lib/opsMail";
import { getSupabaseAdmin } from "@/lib/supabase";
import { UNLOCK_TTL_MS, type Grant } from "./stepUpCore";

/** Data access for Admin step-up. Tables: docs/supabase/admin_step_up.sql (service_role only). */

export type FactorRow = {
  operator: string;
  secret_enc: string | null;
  pending_secret_enc: string | null;
  enrolled_at: string | null;
  needs_reenrol: boolean;
  failed_count: number;
  locked_until: string | null;
  last_step: number | null;
};

export function stepUpKey(): string {
  return String(process.env.ADMIN_STEP_UP_KEY || "");
}

export function stepUpIssuer(): string {
  const env = String(process.env.VERCEL_ENV || process.env.NODE_ENV || "");
  return env === "production" ? "Scalers Admin" : "Scalers Admin (staging)";
}

export async function loadFactor(operator: string): Promise<FactorRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("admin_step_up_factor")
    .select("operator, secret_enc, pending_secret_enc, enrolled_at, needs_reenrol, failed_count, locked_until, last_step")
    .eq("operator", operator)
    .maybeSingle();
  if (error) throw error;
  return (data as FactorRow | null) ?? null;
}

export async function saveFactor(operator: string, patch: Partial<FactorRow>): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("admin_step_up_factor")
    .upsert({ operator, ...patch, updated_at: new Date().toISOString() }, { onConflict: "operator" });
  if (error) throw error;
}

export async function loadBackupCodes(operator: string): Promise<Array<{ id: string; code_hash: string; used_at: string | null }>> {
  const { data, error } = await getSupabaseAdmin()
    .from("admin_step_up_backup_code")
    .select("id, code_hash, used_at")
    .eq("operator", operator)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as Array<{ id: string; code_hash: string; used_at: string | null }>;
}

/** Atomic single use: only flips a code that is still unused. */
export async function consumeBackupCode(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("admin_step_up_backup_code")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .select("id");
  if (error) throw error;
  return (data || []).length === 1;
}

export async function replaceBackupCodes(operator: string, hashes: string[]): Promise<void> {
  const admin = getSupabaseAdmin();
  const del = await admin.from("admin_step_up_backup_code").delete().eq("operator", operator);
  if (del.error) throw del.error;
  const ins = await admin.from("admin_step_up_backup_code").insert(hashes.map((code_hash) => ({ operator, code_hash })));
  if (ins.error) throw ins.error;
}

export async function createGrant(operator: string, method: "totp" | "backup_code", action: string): Promise<{ id: string; expiresAt: number }> {
  const expiresAt = Date.now() + UNLOCK_TTL_MS;
  const { data, error } = await getSupabaseAdmin()
    .from("admin_step_up_grant")
    .insert({ operator, method, action, expires_at: new Date(expiresAt).toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return { id: String((data as { id: string }).id), expiresAt };
}

export async function loadGrant(id: string | undefined | null): Promise<(Grant & { id: string }) | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("admin_step_up_grant")
    .select("id, operator, expires_at, revoked_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; operator: string; expires_at: string; revoked_at: string | null };
  if (row.revoked_at) return null;
  return { id: row.id, operator: row.operator, expiresAt: Date.parse(row.expires_at) };
}

/** Operator reset via the DB function (same one the break-glass runbook uses). */
export async function resetFactor(target: string, actor: string, reason: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("admin_step_up_reset", {
    p_operator: target,
    p_actor: actor,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function auditStepUp(actor: string, action: string, detail: Record<string, unknown>, reason?: string | null) {
  await recordAdminAction({ actor, action, reason: reason ?? null, detail });
}

/** Never let a backup code or authenticator code reach an email body (reasons are free text). */
export function redactStepUpCodes(text: string): string {
  return String(text || "")
    .replace(/\b[a-z0-9]{5}-?[a-z0-9]{5}\b/gi, "[redacted]")
    .replace(/\b\d{6}\b/g, "[redacted]");
}

/**
 * Security email. Never includes backup codes or authenticator codes. Uses the existing ops mail path (Resend). Recipient comes from
 * ADMIN_STEP_UP_ALERT_EMAIL; when it or Resend is unset, the notice is skipped and logged.
 */
export async function sendStepUpNotice(kind: "backup_code_used" | "authenticator_reset", operator: string, extra: string) {
  const to = String(process.env.ADMIN_STEP_UP_ALERT_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) {
    console.info(JSON.stringify({ event: "step-up-notice-skipped", kind, operator, why: "ADMIN_STEP_UP_ALERT_EMAIL unset" }));
    return;
  }
  const subject = kind === "backup_code_used"
    ? `Scalers Admin: a backup code was used for ${operator}`
    : `Scalers Admin: authenticator reset for ${operator}`;
  const text = `${subject}.\n\n${redactStepUpCodes(extra)}\n\nIf this wasn't you, reset the authenticator and sign out all sessions now.`;
  try {
    const res = await sendOpsMail({ to, subject, text });
    if (!res.sent) console.info(JSON.stringify({ event: "step-up-notice-skipped", kind, operator, why: res.skipped }));
  } catch (err) {
    console.error(JSON.stringify({ event: "step-up-notice-failed", kind, operator, error: String((err as Error)?.message || err) }));
  }
}
