import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { stepUpMode } from "@/lib/ops/stepUp";
import {
  decryptSecret, encryptSecret, generateBackupCodes, generateTotpSecret, grantValid, hashBackupCode, otpauthUri, UNLOCK_COOKIE, verifyTotp,
} from "@/lib/ops/stepUpCore";
import { unlockTtlMs } from "@/lib/ops/stepUpTime";
import { auditStepUp, createGrant, loadFactor, loadGrant, loadUnlockMinutes, replaceBackupCodes, saveFactor, stepUpIssuer, stepUpKey } from "@/lib/ops/stepUpStore";

/**
 * Authenticator setup. start: new secret (stored encrypted as pending) + QR + manual key.
 * confirm: first valid code activates it, retires any old secret, and returns 10 backup codes once.
 * Allowed when not enrolled (first time or after a reset) or with a live unlock (e.g. right after a backup code).
 */
export async function POST(req: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (stepUpMode() !== "enforce") return NextResponse.json({ error: "step_up_not_enforced", message: "Authenticator setup opens when Unlock is enforced." }, { status: 409 });
  const key = stepUpKey();
  if (key.length < 16) return NextResponse.json({ error: "step_up_misconfigured", message: "Unlock is not configured on this server." }, { status: 500 });
  const op = gate.operator;
  const body = (await req.json().catch(() => ({}))) as { op?: unknown; code?: unknown };
  const factor = await loadFactor(op);
  const enrolled = !!factor?.enrolled_at && !!factor.secret_enc;
  const jar = await cookies();
  const grant = await loadGrant(jar.get(UNLOCK_COOKIE)?.value);
  // Re-enrol after a backup code uses the unlock that code just granted; a reset clears enrolment.
  const allowed = !enrolled || grantValid(grant, op, Date.now());
  if (!allowed) return NextResponse.json({ error: "step_up_required", message: "Unlock first to change your authenticator." }, { status: 403 });

  if (body.op === "start") {
    const secret = generateTotpSecret();
    await saveFactor(op, { pending_secret_enc: encryptSecret(secret, key) });
    const uri = otpauthUri(secret, op, stepUpIssuer());
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return NextResponse.json({ secret, qrSvg });
  }

  if (body.op === "confirm") {
    if (!factor?.pending_secret_enc) return NextResponse.json({ error: "Start setup first." }, { status: 400 });
    const secret = decryptSecret(factor.pending_secret_enc, key);
    const step = verifyTotp(secret, String(body.code || ""), Date.now());
    if (step == null) {
      await auditStepUp(op, "admin.step_up.failed", { intent: "enrol" });
      return NextResponse.json({ error: "step_up_wrong_code", message: "That code didn't work. Try the newest code." }, { status: 403 });
    }
    const codes = generateBackupCodes();
    await replaceBackupCodes(op, codes.map((c) => hashBackupCode(c, key)));
    await saveFactor(op, {
      secret_enc: factor.pending_secret_enc, pending_secret_enc: null, enrolled_at: new Date().toISOString(),
      needs_reenrol: false, failed_count: 0, locked_until: null, last_step: step,
    });
    await auditStepUp(op, "admin.2fa.enrolled", { replaced: enrolled });
    const ttlMs = unlockTtlMs(await loadUnlockMinutes());
    const g = await createGrant(op, "totp", "enrol", ttlMs);
    const res = NextResponse.json({ ok: true, backupCodes: codes, unlockedUntil: new Date(g.expiresAt).toISOString() });
    res.cookies.set(UNLOCK_COOKIE, g.id, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: Math.floor(ttlMs / 1000) });
    return res;
  }
  return NextResponse.json({ error: "Unknown step." }, { status: 400 });
}
