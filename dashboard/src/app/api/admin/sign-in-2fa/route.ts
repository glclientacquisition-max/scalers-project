import { NextResponse } from "next/server";
import { findAdminOperator, normalizeAdminUsername } from "@/lib/adminOperators";
import { getAdminSessionRaw, signInTwoFactorPassed } from "@/lib/auth";
import {
  afterFailure, afterSuccess, EMAIL_FAILED_MESSAGE, decryptSecret, EMAIL_CODE_TTL_MS, emailSendDecision, generateEmailCode, hashEmailCode, isLocked,
  maskEmail, matchBackupCode, matchEmailCode, SIGNIN_COOKIE, SIGNIN_REMEMBER_MS, signDeviceToken, signInEmailFor,
  signInTwoFactorRequired, UNLOCK_COOKIE, UNLOCK_TTL_MS, verifyTotp,
} from "@/lib/ops/stepUpCore";
import {
  auditStepUp, consumeBackupCode, createGrant, consumeEmailCode, insertEmailCode, loadBackupCodes, loadFactor, recentEmailCodes,
  retireEmailCodes, saveFactor, sendSignInCodeEmail, sendStepUpNotice, stepUpKey,
} from "@/lib/ops/stepUpStore";

/**
 * Sign-in 2FA for Super Admin (Alvin, 24 Oct 2026). Runs after username + access code, on the
 * Better Auth session alone (getAdminSessionRaw). Authenticator first; email code fallback;
 * backup codes work too. Shares lockout with Unlock (5 wrong = 15 min). Success sets a signed,
 * httpOnly device cookie bound to the operator for 12 hours. Codes never reach logs or audit rows.
 */
async function signedInOperator(): Promise<string | null> {
  const s = await getAdminSessionRaw();
  const name = normalizeAdminUsername(String(s?.user?.name || ""));
  if (!name || !findAdminOperator(name)) return null;
  return name;
}

export async function GET() {
  const op = await signedInOperator();
  if (!op) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!signInTwoFactorRequired()) return NextResponse.json({ required: false });
  const factor = await loadFactor(op);
  const email = signInEmailFor(op);
  const now = Date.now();
  return NextResponse.json({
    required: true,
    passed: await signInTwoFactorPassed(op),
    operator: op,
    enrolled: !!factor?.enrolled_at && !!factor.secret_enc,
    emailHint: email ? maskEmail(email) : null,
    lockedUntil: factor?.locked_until && Date.parse(factor.locked_until) > now ? factor.locked_until : null,
  });
}

export async function POST(req: Request) {
  const op = await signedInOperator();
  if (!op) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!signInTwoFactorRequired()) return NextResponse.json({ ok: true, next: "/admin" });
  const key = stepUpKey();
  if (key.length < 16) return NextResponse.json({ error: "step_up_misconfigured", message: "Sign-in check is not configured on this server." }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { op?: unknown; code?: unknown };
  const step = String(body.op || "");
  const code = String(body.code || "").trim();
  const now = Date.now();
  const factor = await loadFactor(op);
  const enrolled = !!factor?.enrolled_at && !!factor.secret_enc;
  const lock = { failedCount: factor?.failed_count || 0, lockedUntil: factor?.locked_until ? Date.parse(factor.locked_until) : null };
  if (isLocked(lock, now)) {
    return NextResponse.json({ error: "step_up_locked", lockedUntil: factor!.locked_until, message: "Too many wrong codes. Try again after the lock ends." }, { status: 429 });
  }

  if (step === "email_send") {
    const to = signInEmailFor(op);
    if (!to) return NextResponse.json({ error: "email_unavailable", message: "No email is set for sign-in codes. Use your authenticator." }, { status: 409 });
    const recent = await recentEmailCodes(op, now - 60 * 60 * 1000);
    const d = emailSendDecision(recent.map((r) => Date.parse(r.created_at)), now);
    if (!d.ok) {
      await auditStepUp(op, "admin.2fa.sign_in.email_rate_limited", { retry_after_s: d.retryAfterS });
      return NextResponse.json({ error: "email_rate_limited", retryAfterS: d.retryAfterS, message: `Wait ${d.retryAfterS}s before asking for another code.` }, { status: 429 });
    }
    const emailCode = generateEmailCode();
    await insertEmailCode(op, hashEmailCode(emailCode, op, key), now + EMAIL_CODE_TTL_MS, to);
    const sent = await sendSignInCodeEmail(to, emailCode);
    if (!sent.sent) {
      // Never pretend: retire the unsent code, audit why (no code in the row), say so on screen.
      await retireEmailCodes(op).catch(() => {});
      await auditStepUp(op, "admin.2fa.sign_in.email_failed", { to: maskEmail(to), why: sent.why ?? "unknown" });
      return NextResponse.json({ error: "email_failed", message: EMAIL_FAILED_MESSAGE }, { status: 502 });
    }
    await auditStepUp(op, "admin.2fa.sign_in.email_sent", { to: maskEmail(to), delivered: true });
    return NextResponse.json({ ok: true, sentTo: maskEmail(to), expiresInS: EMAIL_CODE_TTL_MS / 1000 });
  }

  let method: "totp" | "backup_code" | "email" | null = null;
  let totpStepOk: number | null = null;
  if (step === "totp") {
    if (!enrolled) return NextResponse.json({ error: "step_up_enrolment_required", message: "No authenticator yet. Use an email code." }, { status: 409 });
    let secret: string;
    try { secret = decryptSecret(factor!.secret_enc!, key); } catch {
      return NextResponse.json({ error: "step_up_misconfigured", message: "Sign-in check is not configured on this server." }, { status: 500 });
    }
    totpStepOk = verifyTotp(secret, code, now, factor!.last_step ?? null);
    if (totpStepOk != null) method = "totp";
  } else if (step === "backup") {
    const rows = await loadBackupCodes(op);
    const idx = matchBackupCode(code, rows, key);
    if (idx >= 0 && (await consumeBackupCode(rows[idx].id))) method = "backup_code";
  } else if (step === "email_verify") {
    const rows = await recentEmailCodes(op, now - EMAIL_CODE_TTL_MS - 60_000);
    const idx = matchEmailCode(code, op, rows, key, now);
    if (idx >= 0 && (await consumeEmailCode(rows[idx].id))) method = "email";
  } else {
    return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  }

  if (!method) {
    const next = afterFailure(lock, now);
    await saveFactor(op, { failed_count: next.failedCount, locked_until: next.lockedUntil ? new Date(next.lockedUntil).toISOString() : null });
    await auditStepUp(op, "admin.2fa.sign_in.failed", { method: step });
    if (next.justLocked) {
      await auditStepUp(op, "admin.2fa.sign_in.locked", { minutes: 15 });
      return NextResponse.json({ error: "step_up_locked", lockedUntil: new Date(next.lockedUntil!).toISOString(), message: "Too many wrong codes. Locked for 15 minutes." }, { status: 429 });
    }
    return NextResponse.json({ error: "wrong_code", message: step === "email_verify" ? "That code didn't work or has expired." : "That code didn't work. Try the newest one." }, { status: 403 });
  }

  await saveFactor(op, {
    failed_count: afterSuccess().failedCount, locked_until: null,
    ...(totpStepOk != null ? { last_step: totpStepOk } : {}),
    ...(method === "backup_code" ? { needs_reenrol: true } : {}),
  });
  if (method === "email") await retireEmailCodes(op);
  await auditStepUp(op, "admin.2fa.sign_in.verified", { method, enrolled });
  if (method === "backup_code") {
    await auditStepUp(op, "admin.2fa.backup_code_used", { intent: "sign_in" });
    await sendStepUpNotice("backup_code_used", op, "Used at sign-in. Set up your authenticator again on your new phone; that retires the old one.");
  }
  const needsSetup = !enrolled || method === "backup_code";
  const next = needsSetup ? "/admin/settings/security?setup=1" : "/admin";
  const exp = now + SIGNIN_REMEMBER_MS;
  const res = NextResponse.json({ ok: true, method, next });
  res.cookies.set(SIGNIN_COOKIE, signDeviceToken(op, exp, key), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: Math.floor(SIGNIN_REMEMBER_MS / 1000),
  });
  if (method === "backup_code") {
    // Same as Unlock: the backup code grants a 10-minute unlock so re-enrolment can replace the lost phone.
    const g = await createGrant(op, "backup_code", "sign_in");
    res.cookies.set(UNLOCK_COOKIE, g.id, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: Math.floor(UNLOCK_TTL_MS / 1000) });
  }
  return res;
}
