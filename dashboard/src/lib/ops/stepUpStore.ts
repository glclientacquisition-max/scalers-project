import "server-only";
import { recordAdminAction } from "@/lib/adminAudit";
import { sendOpsMail } from "@/lib/opsMail";
import { getSupabaseAdmin } from "@/lib/supabase";
import { clampUnlockMinutes, UNLOCK_DEFAULT_MINUTES, unlockTtlMs } from "./stepUpTime";
import { isUnlockArea, type Grant, type UnlockArea, type UnlockAreaSettings } from "./stepUpCore";

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

/** ttlMs is fixed when the grant is made: a later duration change never stretches or cuts a live Unlock. */
export async function createGrant(operator: string, method: "totp" | "backup_code", action: string, ttlMs: number = unlockTtlMs(UNLOCK_DEFAULT_MINUTES)): Promise<{ id: string; expiresAt: number }> {
  const expiresAt = Date.now() + ttlMs;
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

/** Logout: mark a live Unlock grant revoked so the cookie id is dead even if replayed. */
export async function revokeGrant(id: string | undefined | null): Promise<void> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
  await getSupabaseAdmin()
    .from("admin_step_up_grant")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
}

export type SecurityEvent = { id: string; created_at: string; actor: string; action: string };

/** Last N sign-in / Unlock events for Settings › Security. Detail is never read (no codes there anyway). */
export async function recentSecurityEvents(limit = 20): Promise<SecurityEvent[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("ops_audit_log")
    .select("id, created_at, actor, action")
    .or("action.like.admin.2fa.%,action.like.admin.step_up.%")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SecurityEvent[];
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

// ---- sign-in email codes (docs/supabase/admin_sign_in_2fa.sql) ----
export type EmailCodeRow = { id: string; code_hash: string; used_at: string | null; expires_at: string; created_at: string };

export async function recentEmailCodes(operator: string, sinceMs: number): Promise<EmailCodeRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("admin_sign_in_email_code")
    .select("id, code_hash, used_at, expires_at, created_at")
    .eq("operator", operator)
    .gte("created_at", new Date(sinceMs).toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as EmailCodeRow[];
}

export async function insertEmailCode(operator: string, codeHash: string, expiresAt: number, sentTo: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("admin_sign_in_email_code")
    .insert({ operator, code_hash: codeHash, expires_at: new Date(expiresAt).toISOString(), sent_to: sentTo });
  if (error) throw error;
}

/** Atomic single use. */
export async function consumeEmailCode(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("admin_sign_in_email_code")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .select("id");
  if (error) throw error;
  return (data || []).length === 1;
}

/** Retire every other live code once one is used. */
export async function retireEmailCodes(operator: string): Promise<void> {
  await getSupabaseAdmin()
    .from("admin_sign_in_email_code")
    .update({ used_at: new Date().toISOString() })
    .eq("operator", operator)
    .is("used_at", null);
}

/** The sign-in code email. The only email that ever carries a code. */
export async function sendSignInCodeEmail(to: string, code: string): Promise<{ sent: boolean; why?: string }> {
  try {
    const res = await sendOpsMail({
      to: [to],
      subject: "Scalers Admin sign-in code",
      text: `Your Scalers Admin sign-in code is ${code}.\n\nIt works once and expires in 10 minutes.\n\nIf you didn't try to sign in, change your access code now.`,
    });
    return res.sent ? { sent: true } : { sent: false, why: res.skipped };
  } catch (err) {
    console.error(JSON.stringify({ event: "admin-2fa-email-failed", error: String((err as Error)?.message || err).slice(0, 200) }));
    return { sent: false, why: "send_failed" };
  }
}

export async function backupCodesLeft(operator: string): Promise<number> {
  return (await loadBackupCodes(operator)).filter((r) => !r.used_at).length;
}

/** Enrolment status for the Security screen. Never returns secrets. */
export async function factorStatuses(operators: string[]): Promise<Record<string, { enrolled: boolean; needsReenrol: boolean; lockedUntil: string | null }>> {
  const out: Record<string, { enrolled: boolean; needsReenrol: boolean; lockedUntil: string | null }> = {};
  for (const op of operators) out[op] = { enrolled: false, needsReenrol: false, lockedUntil: null };
  if (!operators.length) return out;
  const { data, error } = await getSupabaseAdmin()
    .from("admin_step_up_factor")
    .select("operator, enrolled_at, secret_enc, needs_reenrol, locked_until")
    .in("operator", operators);
  if (error) throw error;
  for (const r of (data || []) as Array<{ operator: string; enrolled_at: string | null; secret_enc: string | null; needs_reenrol: boolean; locked_until: string | null }>) {
    out[r.operator] = {
      enrolled: !!r.enrolled_at && !!r.secret_enc,
      needsReenrol: !!r.needs_reenrol,
      lockedUntil: r.locked_until && Date.parse(r.locked_until) > Date.now() ? r.locked_until : null,
    };
  }
  return out;
}

export type AreaRow = { area: UnlockArea; required: boolean; updated_by: string | null; updated_at: string | null };

/**
 * Area switches (docs/supabase/admin_step_up_area.sql). Fails closed: a read error or a
 * missing row means the area needs Unlock.
 */
export async function loadAreaRows(): Promise<AreaRow[]> {
  const { data, error } = await getSupabaseAdmin().from("admin_step_up_area").select("area, required, updated_by, updated_at");
  if (error) throw error;
  return ((data ?? []) as AreaRow[]).filter((r) => isUnlockArea(r.area));
}

export async function loadAreaSettings(): Promise<UnlockAreaSettings> {
  try {
    const out: UnlockAreaSettings = {};
    for (const r of await loadAreaRows()) out[r.area] = r.required !== false;
    return out;
  } catch {
    return {};
  }
}

export async function saveAreaSetting(area: UnlockArea, required: boolean, actor: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("admin_step_up_area")
    .upsert({ area, required, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: "area" });
  if (error) throw error;
}

/**
 * "Unlock lasts" (docs/supabase/admin_step_up_setting.sql). One row; read errors or a missing
 * row mean the 10-minute default. Always clamped to 5–30 on the way out.
 */
export async function loadUnlockSetting(): Promise<{ minutes: number; updatedBy: string | null; updatedAt: string | null }> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("admin_step_up_setting")
      .select("unlock_minutes, updated_by, updated_at")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return { minutes: UNLOCK_DEFAULT_MINUTES, updatedBy: null, updatedAt: null };
    const row = data as { unlock_minutes: number; updated_by: string | null; updated_at: string | null };
    return { minutes: clampUnlockMinutes(row.unlock_minutes), updatedBy: row.updated_by, updatedAt: row.updated_at };
  } catch {
    return { minutes: UNLOCK_DEFAULT_MINUTES, updatedBy: null, updatedAt: null };
  }
}

export async function loadUnlockMinutes(): Promise<number> {
  return (await loadUnlockSetting()).minutes;
}

export async function saveUnlockMinutes(minutes: number, actor: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("admin_step_up_setting")
    .upsert({ id: true, unlock_minutes: clampUnlockMinutes(minutes), updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
}
