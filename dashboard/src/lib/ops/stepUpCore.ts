/**
 * Admin step-up core (Unlock enforce, Alvin 24 Oct 2026). Pure: node:crypto only, no `@/` imports.
 * TOTP per RFC 6238 (SHA-1, 30 s, 6 digits, ±1 step). Backup codes stored as hashes.
 * Never log secrets, codes, or cookies.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const UNLOCK_TTL_MS = 10 * 60 * 1000;
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const BACKUP_CODE_COUNT = 10;
export const UNLOCK_COOKIE = "scalers_admin_unlock";
export const MIN_REASON = 3;

/** Exact value `on` enables enforcement. Anything else leaves prod unchanged. */
export function stepUpEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.ADMIN_STEP_UP_ENFORCE ?? "") === "on";
}

/**
 * Risky Admin actions that need a live unlock when enforced. Keys are `<route>:<action>`.
 * Mirrors every write currently behind UnlockCta / StepUpSheet.
 */
const RISKY = new Set<string>([
  "did-pool:release",
  "did-pool:assign_specific",
  "did-pool:assign_next",
  "businesses:release_did",
  "businesses:archive",
  "businesses:transfer_owner",
  "businesses:assign_next",
  "invoice:void",
  "invoice:credit_note",
  "number-hold:hold",
  "number-hold:end_hold",
  "number-hold:restore",
  "number-hold:set_settings",
  "number-hold:bill_fee",
  "package-versions:publish",
  "package-versions:move_subscribers",
  "package-versions:set_billing_mode",
  "billing:grant_minutes",
  "billing:assign_package",
  "billing:resolve_checkout_review",
  "billing:set_billing_mode",
  "platform-ops:save_settings",
]);

export function isRiskyAction(key: string): boolean {
  return RISKY.has(key);
}

export function riskyActions(): string[] {
  return [...RISKY].sort();
}

// ---- base32 (RFC 4648, no padding) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("bad base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secretB32: string, counter: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const off = mac[mac.length - 1] & 0xf;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_S);
}

export function totpAt(secretB32: string, nowMs: number): string {
  return hotp(secretB32, totpStep(nowMs));
}

function eq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Returns the matched step, or null. `lastStep` refuses replay of an already-accepted step.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  nowMs: number,
  lastStep: number | null = null,
  window = TOTP_WINDOW,
): number | null {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const base = totpStep(nowMs);
  for (let d = -window; d <= window; d += 1) {
    const step = base + d;
    if (lastStep != null && step <= lastStep) continue;
    if (eq(hotp(secretB32, step), c)) return step;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_S) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// ---- backup codes ----
export function normalizeBackupCode(code: string): string {
  return String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function generateBackupCodes(n = BACKUP_CODE_COUNT): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes: string[] = [];
  while (codes.length < n) {
    const bytes = randomBytes(10);
    let s = "";
    for (const b of bytes) s += alphabet[b % alphabet.length];
    const code = `${s.slice(0, 5)}-${s.slice(5)}`;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

export function hashBackupCode(code: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:${normalizeBackupCode(code)}`).digest("hex");
}

/** Single use: returns the index of the first unused matching hash, or -1. */
export function matchBackupCode(
  code: string,
  rows: Array<{ code_hash: string; used_at: string | null }>,
  pepper: string,
): number {
  if (normalizeBackupCode(code).length !== 10) return -1;
  const h = hashBackupCode(code, pepper);
  return rows.findIndex((r) => !r.used_at && eq(r.code_hash, h));
}

// ---- secret at rest (AES-256-GCM) ----
function keyFrom(raw: string): Buffer {
  if (!raw || raw.length < 16) throw new Error("ADMIN_STEP_UP_KEY missing or too short");
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string, rawKey: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFrom(rawKey), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(blob: string, rawKey: string): string {
  const [v, iv, tag, body] = String(blob).split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("bad secret blob");
  const d = createDecipheriv("aes-256-gcm", keyFrom(rawKey), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

// ---- lockout ----
export type LockState = { failedCount: number; lockedUntil: number | null };

export function isLocked(s: LockState, nowMs: number): boolean {
  return s.lockedUntil != null && s.lockedUntil > nowMs;
}

/** Apply one wrong code. 5 wrong codes lock for 15 minutes and reset the counter. */
export function afterFailure(s: LockState, nowMs: number): LockState & { justLocked: boolean } {
  const base = s.lockedUntil != null && s.lockedUntil <= nowMs ? 0 : s.failedCount;
  const next = base + 1;
  if (next >= MAX_FAILURES) return { failedCount: 0, lockedUntil: nowMs + LOCK_MS, justLocked: true };
  return { failedCount: next, lockedUntil: null, justLocked: false };
}

export function afterSuccess(): LockState {
  return { failedCount: 0, lockedUntil: null };
}

// ---- unlock grant ----
export type Grant = { operator: string; expiresAt: number };

export function grantValid(g: Grant | null | undefined, operator: string, nowMs: number): boolean {
  return !!g && g.operator === operator && g.expiresAt > nowMs;
}

/**
 * Pure gate decision for a risky write. When enforced and the action is risky,
 * the caller must hold a live grant for the same operator.
 */
export function gateDecision(input: {
  enforced: boolean;
  actionKey: string;
  operator: string;
  grant: Grant | null;
  nowMs: number;
}): { ok: true } | { ok: false; status: 403; error: "step_up_required" } {
  if (!input.enforced || !isRiskyAction(input.actionKey)) return { ok: true };
  if (grantValid(input.grant, input.operator, input.nowMs)) return { ok: true };
  return { ok: false, status: 403, error: "step_up_required" };
}

export function validateResetReason(reason: unknown): string | null {
  const r = String(reason ?? "").trim();
  return r.length >= MIN_REASON ? r.slice(0, 500) : null;
}
