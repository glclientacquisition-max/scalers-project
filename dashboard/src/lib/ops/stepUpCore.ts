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
 * One registry for every mutating Admin API route (Alvin, 24 Oct 2026).
 * Every POST/PUT/PATCH/DELETE route under app/api/admin and app/api/did-pool must be listed here,
 * and every action it handles must be classified `risky` (needs a live Unlock when
 * ADMIN_STEP_UP_ENFORCE=on) or `safe`. tests/adminStepUpRoutes.test.js fails CI otherwise.
 *
 * `prefix` is the gate key prefix: the route calls stepUpGate(…, `${prefix}:${action}`).
 * `auth` routes run before a full session (sign-in, Unlock itself) and are never gated.
 */
export type AdminWriteRoute = {
  /** Path under dashboard/src/app/api, without /route.ts. */
  file: string;
  prefix: string | null;
  risky: string[];
  safe: string[];
  /** auth: sign-in / Unlock plumbing. single: one action, no `action` field in the body. */
  kind?: "auth" | "single";
  /** Settings › Security "What needs Unlock" area. Required: CI fails a route without one. */
  area: UnlockArea;
  /** Per-action area when an action belongs elsewhere (e.g. businesses:release_did → numbers). */
  actionArea?: Record<string, UnlockArea>;
  note?: string;
};

/** Areas an operator can switch on/off in Settings › Security (Alvin, 24 Oct 2026). Default ON. */
export const UNLOCK_AREAS = ["numbers", "billing", "businesses", "voices", "operators"] as const;
export type UnlockArea = (typeof UNLOCK_AREAS)[number];
export type UnlockAreaSettings = Partial<Record<UnlockArea, boolean>>;
export function isUnlockArea(v: unknown): v is UnlockArea {
  return typeof v === "string" && (UNLOCK_AREAS as readonly string[]).includes(v);
}

/**
 * Always need Unlock, whatever the area switch says. Number release (incl. archive-release),
 * invoice void, authenticator reset, backup codes and the area switches themselves.
 */
export const ALWAYS_UNLOCK: Record<string, string> = {
  "did-pool:release": "Releasing a number can't be undone; the number may go to someone else.",
  "businesses:release_did": "Releasing a number can't be undone; the number may go to someone else.",
  "businesses:archive": "Archive releases the business's number too.",
  "invoice:void": "Voiding an invoice changes money records for good.",
  "step-up:reset": "Resetting someone's authenticator could hand over their access.",
  "step-up:regenerate_backup_codes": "Backup codes are a way in; making new ones needs proof it's you.",
  "step-up:set_area": "Turning Unlock off must itself need Unlock.",
  "step-up:set_duration": "A longer Unlock is a bigger window; changing it needs proof it's you.",
  "number-ops:restore": "Bringing a number back changes which business answers its calls.",
  "number-ops:lift_quarantine": "Freeing a number early lets another business take it.",
  "number-ops:move": "Moving a number sends a business's calls somewhere else.",
};

// route-registry:start (route paths and action ids, not screen copy)
export const ADMIN_WRITE_ROUTES: AdminWriteRoute[] = [
  { file: "did-pool", area: "numbers", prefix: "did-pool", risky: ["release", "assign_specific", "assign_next"], safe: ["add"] },
  {
    file: "admin/businesses", area: "businesses", actionArea: { release_did: "numbers", assign_next: "numbers" },
    prefix: "businesses",
    risky: ["release_did", "archive", "transfer_owner", "assign_next"],
    safe: ["suspend", "unsuspend", "restore", "update_profile", "send_owner_reset", "save_recording_retention"],
  },
  {
    file: "admin/businesses/[id]/kb", area: "businesses",
    prefix: "business-kb",
    risky: ["set_brain_target", "set_brain_mode"],
    safe: ["check"],
    note: "v2 Knowledge Base: hold a Business on the old brain or let readiness move it; Take messages only on or off. Check again is read-only.",
  },
  {
    file: "admin/billing/invoices/[id]/actions", area: "billing",
    prefix: "invoice",
    risky: ["void", "credit_note"],
    safe: ["dispute", "clear_dispute", "resend"],
  },
  {
    file: "admin/number-hold", area: "numbers",
    prefix: "number-hold",
    risky: ["hold", "end_hold", "restore", "set_settings", "bill_fee"],
    safe: [],
  },
  {
    file: "admin/number-ops", area: "numbers",
    prefix: "number-ops",
    risky: ["restore", "lift_quarantine", "move"],
    safe: [],
    note: "Admin number controls v1 (#968 RPCs). Always needs Unlock + reason; every number treated the same (no protected line).",
  },
  {
    file: "admin/package-versions", area: "billing",
    prefix: "package-versions",
    risky: ["publish", "move_subscribers", "set_billing_mode"],
    safe: ["draft", "update_draft", "archive", "discard_draft", "approve", "set_new_signup_trial", "set_price_approval_threshold"],
  },
  {
    file: "admin/billing", area: "billing",
    prefix: "billing",
    risky: ["grant_minutes", "assign_package", "resolve_checkout_review", "set_billing_mode"],
    safe: ["unassign_package", "mint_pay_link"],
  },
  {
    file: "admin/wallets", area: "billing",
    prefix: "wallets",
    risky: ["set_billing_mode"],
    safe: [],
    note: "Same billing-mode switch as billing:set_billing_mode, older screen.",
  },
  {
    file: "admin/platform-ops", area: "operators",
    prefix: "platform-ops",
    risky: ["save_settings"],
    safe: ["test_send", "prepare_resend", "verify_resend", "ack"],
  },
  {
    file: "admin/step-up/reset", area: "operators",
    prefix: "step-up",
    risky: ["reset"],
    safe: [],
    kind: "single",
    note: "Operator reset: live unlock + reason, never self.",
  },
  {
    file: "admin/step-up/backup-codes", area: "operators",
    prefix: "step-up",
    risky: ["regenerate_backup_codes"],
    safe: [],
    kind: "single",
  },
  { file: "admin/packages", area: "billing", prefix: null, risky: [], safe: ["save_rates", "save_package"], note: "Ungated by decision: legacy rate card edits; package publish is package-versions." },
  { file: "admin/voices", area: "voices", prefix: "voices", risky: ["delete"], safe: ["upsert", "set_default", "set_active"], note: "Delete is destructive; edits stay ungated." },
  { file: "admin/billing/flags", area: "billing", prefix: null, risky: [], safe: ["save"], kind: "single", note: "Ungated by decision." },
  { file: "admin/billing/test-invoice", area: "billing", prefix: null, risky: [], safe: ["create"], kind: "single", note: "Ungated by decision: KSh 10 test invoice." },
  { file: "admin/buy-number", area: "numbers", prefix: "buy-number", risky: ["buy"], safe: [], kind: "single", note: "Spends money on a new DID." },
  { file: "admin/sautikit-sync", area: "voices", prefix: null, risky: [], safe: ["sync"], kind: "single", note: "Ungated by decision: read-only sync." },
  { file: "admin/session", area: "operators", prefix: null, risky: [], safe: ["sign_in"], kind: "auth" },
  { file: "admin/sign-in-2fa", area: "operators", prefix: null, risky: [], safe: ["totp", "backup", "email_send", "email_verify"], kind: "auth" },
  { file: "admin/step-up", area: "operators", prefix: null, risky: [], safe: ["unlock"], kind: "auth" },
  { file: "admin/step-up/session", area: "operators", prefix: null, risky: [], safe: ["end_unlock", "forget_device"], kind: "auth", note: "Ends your own Unlock or forgets this device; only ever narrows access." },
  {
    file: "admin/step-up/areas", area: "operators",
    prefix: "step-up",
    risky: ["set_area"],
    safe: [],
    kind: "single",
    note: "Settings › Security area switches. Always needs Unlock + reason.",
  },
  {
    file: "admin/step-up/duration", area: "operators",
    prefix: "step-up",
    risky: ["set_duration"],
    safe: [],
    kind: "single",
    note: "Settings › Security \"Unlock lasts\". Always needs Unlock + reason; applies to the next Unlock.",
  },
  { file: "admin/step-up/enrol", area: "operators", prefix: null, risky: [], safe: ["start", "confirm"], kind: "auth", note: "Allowed unenrolled (after sign-in 2FA) or with a live unlock." },
];
// route-registry:end

/** `<prefix>:<action>` keys that need a live unlock. */
export function riskyActionKeys(): string[] {
  const out: string[] = [];
  for (const r of ADMIN_WRITE_ROUTES) for (const a of r.risky) out.push(`${r.prefix}:${a}`);
  return out.sort();
}

/**
 * Risky Admin actions that need a live unlock when enforced. Keys are `<prefix>:<action>`.
 * Single source: ADMIN_WRITE_ROUTES above (CI checks every mutating admin route is classified there).
 */
const RISKY = new Set<string>(riskyActionKeys());

export function isRiskyAction(key: string): boolean {
  return RISKY.has(key);
}

export function riskyActions(): string[] {
  return [...RISKY].sort();
}

/** Area for a `<prefix>:<action>` key, from the registry. */
export function areaForAction(key: string): UnlockArea | null {
  const i = key.indexOf(":");
  const prefix = key.slice(0, i), action = key.slice(i + 1);
  for (const r of ADMIN_WRITE_ROUTES) {
    if (r.prefix === prefix && r.risky.includes(action)) return r.actionArea?.[action] ?? r.area;
  }
  return null;
}

/** Risky keys grouped by area (Settings › Security). */
export function riskyKeysByArea(): Record<UnlockArea, string[]> {
  const out = Object.fromEntries(UNLOCK_AREAS.map((a) => [a, [] as string[]])) as Record<UnlockArea, string[]>;
  for (const k of riskyActionKeys()) out[areaForAction(k)!].push(k);
  return out;
}

/** Does this key need a live Unlock under these area settings? Missing setting = ON. */
export function requiresUnlock(key: string, settings: UnlockAreaSettings = {}): boolean {
  if (!isRiskyAction(key)) return false;
  if (ALWAYS_UNLOCK[key]) return true;
  const area = areaForAction(key);
  return !area || settings[area] !== false;
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
  /** Area switches from admin_step_up_area. Omitted / missing row = ON. */
  areas?: UnlockAreaSettings;
}): { ok: true } | { ok: false; status: 403; error: "step_up_required" } {
  if (!input.enforced || !requiresUnlock(input.actionKey, input.areas)) return { ok: true };
  if (grantValid(input.grant, input.operator, input.nowMs)) return { ok: true };
  return { ok: false, status: 403, error: "step_up_required" };
}

export function validateResetReason(reason: unknown): string | null {
  const r = String(reason ?? "").trim();
  return r.length >= MIN_REASON ? r.slice(0, 500) : null;
}

// ---- sign-in 2FA (Alvin, 24 Oct 2026). Same flag as Unlock: ADMIN_STEP_UP_ENFORCE=on. ----
export const SIGNIN_COOKIE = "scalers_admin_2fa";
export const SIGNIN_REMEMBER_MS = 12 * 60 * 60 * 1000;
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_MIN_GAP_MS = 60 * 1000;
export const EMAIL_MAX_PER_HOUR = 5;

/** Sign-in 2FA shares the Unlock flag so one switch turns both on and off. */
export function signInTwoFactorRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return stepUpEnforced(env);
}

function deviceMac(operator: string, expMs: number, key: string): string {
  return createHmac("sha256", keyFrom(key)).update(`admin-2fa-device|v1|${operator}|${expMs}`).digest("base64url");
}

/** Remember-this-device token: `v1.<operator b64url>.<expMs>.<hmac>`, bound to the operator. */
export function signDeviceToken(operator: string, expMs: number, key: string): string {
  return `v1.${Buffer.from(operator).toString("base64url")}.${expMs}.${deviceMac(operator, expMs, key)}`;
}

export function verifyDeviceToken(token: string | undefined | null, operator: string, nowMs: number, key: string): boolean {
  if (!token || !operator || !key || key.length < 16) return false;
  const [v, opB64, expRaw, mac] = String(token).split(".");
  if (v !== "v1" || !opB64 || !expRaw || !mac) return false;
  let op = "";
  try { op = Buffer.from(opB64, "base64url").toString("utf8"); } catch { return false; }
  const exp = Number(expRaw);
  if (op !== operator || !Number.isFinite(exp) || exp <= nowMs || exp > nowMs + SIGNIN_REMEMBER_MS + 60_000) return false;
  return eq(mac, deviceMac(op, exp, key));
}

export function generateEmailCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function hashEmailCode(code: string, operator: string, pepper: string): string {
  return createHash("sha256").update(`email-otp:${pepper}:${operator}:${String(code || "").replace(/\s/g, "")}`).digest("hex");
}

/** Index of a live, unused code row that matches, or -1. */
export function matchEmailCode(
  code: string,
  operator: string,
  rows: Array<{ code_hash: string; used_at: string | null; expires_at: string }>,
  pepper: string,
  nowMs: number,
): number {
  if (!/^\d{6}$/.test(String(code || "").replace(/\s/g, ""))) return -1;
  const h = hashEmailCode(code, operator, pepper);
  return rows.findIndex((r) => !r.used_at && Date.parse(r.expires_at) > nowMs && eq(r.code_hash, h));
}

/** Send rate limit: 1 per 60 s and 5 per rolling hour. `sentAt` = recent send times (ms). */
export function emailSendDecision(sentAt: number[], nowMs: number): { ok: true } | { ok: false; retryAfterS: number } {
  const hour = sentAt.filter((t) => t > nowMs - 60 * 60 * 1000).sort((a, b) => a - b);
  const last = hour[hour.length - 1];
  if (last != null && nowMs - last < EMAIL_MIN_GAP_MS) return { ok: false, retryAfterS: Math.ceil((EMAIL_MIN_GAP_MS - (nowMs - last)) / 1000) };
  if (hour.length >= EMAIL_MAX_PER_HOUR) return { ok: false, retryAfterS: Math.ceil((hour[0] + 60 * 60 * 1000 - nowMs) / 1000) };
  return { ok: true };
}

/** a***@gmail.com */
/** Expiry (ms) of a device token without trusting it; callers verify first. */
export function deviceTokenExpiry(token: string | undefined | null): number | null {
  const exp = Number(String(token || "").split(".")[2]);
  return Number.isFinite(exp) && exp > 0 ? exp : null;
}

/** Where signInEmailFor's address comes from, for the Security screen. */
export function signInEmailSource(operator: string, env: NodeJS.ProcessEnv = process.env): "operator" | "alert" | null {
  if (signInEmailFor(operator, { ADMIN_OPERATOR_EMAILS: env.ADMIN_OPERATOR_EMAILS } as unknown as NodeJS.ProcessEnv)) return "operator";
  return signInEmailFor(operator, env) ? "alert" : null;
}

export const EMAIL_FAILED_MESSAGE = "We couldn't send the email code. Use your authenticator or a backup code.";

export function maskEmail(email: string): string {
  const [u, d] = String(email || "").split("@");
  if (!u || !d) return "";
  return `${u[0]}${"*".repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}`;
}

/**
 * Where the sign-in email code goes. ADMIN_OPERATORS holds no emails, so an optional
 * ADMIN_OPERATOR_EMAILS=user:email,… wins per operator, else ADMIN_STEP_UP_ALERT_EMAIL (first address).
 */
export function signInEmailFor(operator: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const ok = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  for (const part of String(env.ADMIN_OPERATOR_EMAILS || "").split(",")) {
    const i = part.indexOf(":");
    if (i <= 0) continue;
    if (part.slice(0, i).trim().toLowerCase() === operator) {
      const e = part.slice(i + 1).trim();
      if (ok(e)) return e;
    }
  }
  const fallback = String(env.ADMIN_STEP_UP_ALERT_EMAIL || "").split(",").map((s) => s.trim()).find(ok);
  return fallback || null;
}
