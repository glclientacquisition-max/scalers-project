import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { requireStepUp, stepUpMode } from "@/lib/ops/stepUp";
import {
  afterFailure, afterSuccess, decryptSecret, grantValid, isLocked, matchBackupCode, UNLOCK_COOKIE, verifyTotp,
} from "@/lib/ops/stepUpCore";
import { unlockTtlMs } from "@/lib/ops/stepUpTime";
import {
  auditStepUp, consumeBackupCode, createGrant, loadBackupCodes, loadFactor, loadGrant, loadUnlockMinutes, saveFactor, sendStepUpNotice, stepUpKey,
} from "@/lib/ops/stepUpStore";

/**
 * StepUpSheet backend. Unlock never writes domain state.
 * observe/off: logs would-require-step-up, returns { mode, verified:false } (unchanged).
 * enforce (ADMIN_STEP_UP_ENFORCE=on): verifies an authenticator or backup code, then sets a
 * httpOnly unlock marker backed by admin_step_up_grant, lasting Settings › Security "Unlock lasts"
 * (5–30 min, default 10), read fresh for each new Unlock.
 */
export async function GET() {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const mode = stepUpMode();
  if (mode !== "enforce") return NextResponse.json({ mode, enrolled: false, unlockedUntil: null });
  const factor = await loadFactor(gate.operator);
  const jar = await cookies();
  const grant = await loadGrant(jar.get(UNLOCK_COOKIE)?.value);
  const now = Date.now();
  return NextResponse.json({
    mode,
    enrolled: !!factor?.enrolled_at && !!factor.secret_enc,
    needsReenrol: !!factor?.needs_reenrol,
    lockedUntil: factor?.locked_until && Date.parse(factor.locked_until) > now ? factor.locked_until : null,
    unlockedUntil: grantValid(grant, gate.operator, now) ? new Date(grant!.expiresAt).toISOString() : null,
  });
}

export async function POST(req: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; target?: unknown; code?: unknown; backupCode?: unknown };
  const action = String(body.action || "unlock").slice(0, 64);
  const target = body.target == null ? null : String(body.target).slice(0, 64);
  const mode = stepUpMode();
  if (mode !== "enforce") {
    requireStepUp({ action: `unlock:${action}`, operator: gate.operator, target });
    return NextResponse.json({ mode, verified: false });
  }

  const op = gate.operator;
  const factor = await loadFactor(op);
  if (!factor?.enrolled_at || !factor.secret_enc) {
    return NextResponse.json({ mode, verified: false, error: "step_up_enrolment_required", message: "Set up your authenticator first." }, { status: 403 });
  }
  const now = Date.now();
  const lock = { failedCount: factor.failed_count || 0, lockedUntil: factor.locked_until ? Date.parse(factor.locked_until) : null };
  if (isLocked(lock, now)) {
    return NextResponse.json({ mode, verified: false, error: "step_up_locked", lockedUntil: factor.locked_until, message: "Too many wrong codes. Try again after the lock ends." }, { status: 429 });
  }

  const code = String(body.code || "").trim();
  const backup = String(body.backupCode || "").trim();
  let method: "totp" | "backup_code" | null = null;
  let step: number | null = null;

  if (code) {
    let secret: string;
    try {
      secret = decryptSecret(factor.secret_enc, stepUpKey());
    } catch {
      return NextResponse.json({ mode, verified: false, error: "step_up_misconfigured", message: "Unlock is not configured on this server." }, { status: 500 });
    }
    step = verifyTotp(secret, code, now, factor.last_step ?? null);
    if (step != null) method = "totp";
  } else if (backup) {
    const rows = await loadBackupCodes(op);
    const idx = matchBackupCode(backup, rows, stepUpKey());
    if (idx >= 0 && (await consumeBackupCode(rows[idx].id))) method = "backup_code";
  } else {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  if (!method) {
    const next = afterFailure(lock, now);
    await saveFactor(op, { failed_count: next.failedCount, locked_until: next.lockedUntil ? new Date(next.lockedUntil).toISOString() : null });
    await auditStepUp(op, "admin.step_up.failed", { intent: action, target, method: code ? "totp" : "backup_code" });
    if (next.justLocked) {
      await auditStepUp(op, "admin.step_up.locked", { intent: action, minutes: 15 });
      return NextResponse.json({ mode, verified: false, error: "step_up_locked", lockedUntil: new Date(next.lockedUntil!).toISOString(), message: "Too many wrong codes. Locked for 15 minutes." }, { status: 429 });
    }
    return NextResponse.json({ mode, verified: false, error: "step_up_wrong_code", message: "That code didn't work. Check the time on your phone and try again." }, { status: 403 });
  }

  await saveFactor(op, {
    ...{ failed_count: afterSuccess().failedCount, locked_until: null },
    ...(step != null ? { last_step: step } : {}),
    ...(method === "backup_code" ? { needs_reenrol: true } : {}),
  });
  const minutes = await loadUnlockMinutes();
  const ttlMs = unlockTtlMs(minutes);
  const grant = await createGrant(op, method, action, ttlMs);
  await auditStepUp(op, "admin.step_up.verified", { intent: action, target, method, grant_id: grant.id, minutes });
  if (method === "backup_code") {
    await auditStepUp(op, "admin.2fa.backup_code_used", { intent: action });
    await sendStepUpNotice("backup_code_used", op, "Set up your authenticator again on your new phone; that retires the old one.");
  }
  const res = NextResponse.json({ mode, verified: true, method, unlockedUntil: new Date(grant.expiresAt).toISOString(), needsReenrol: method === "backup_code" || factor.needs_reenrol });
  res.cookies.set(UNLOCK_COOKIE, grant.id, {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: Math.floor(ttlMs / 1000),
  });
  return res;
}
