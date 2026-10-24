/**
 * Admin Unlock enforce (Alvin 24 Oct 2026): TOTP window, backup codes single use,
 * lockout, server gate, reset reason, SQL shape.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/stepUpCore.ts"));

// RFC 6238 Appendix B secret "12345678901234567890" (SHA-1), 8 digits → we check the 6-digit tail.
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP", () => {
  it("matches RFC 6238 vectors (6-digit truncation)", async () => {
    const { totpAt } = await load();
    assert.equal(totpAt(RFC_SECRET_B32, 59 * 1000), "287082");
    assert.equal(totpAt(RFC_SECRET_B32, 1111111109 * 1000), "081804");
    assert.equal(totpAt(RFC_SECRET_B32, 1234567890 * 1000), "005924");
  });

  it("accepts ±1 step, rejects ±2, rejects junk", async () => {
    const { verifyTotp, totpAt, totpStep } = await load();
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    assert.equal(verifyTotp(RFC_SECRET_B32, totpAt(RFC_SECRET_B32, now), now), step);
    assert.equal(verifyTotp(RFC_SECRET_B32, totpAt(RFC_SECRET_B32, now - 30_000), now), step - 1);
    assert.equal(verifyTotp(RFC_SECRET_B32, totpAt(RFC_SECRET_B32, now + 30_000), now), step + 1);
    assert.equal(verifyTotp(RFC_SECRET_B32, totpAt(RFC_SECRET_B32, now - 60_000), now), null);
    assert.equal(verifyTotp(RFC_SECRET_B32, totpAt(RFC_SECRET_B32, now + 60_000), now), null);
    assert.equal(verifyTotp(RFC_SECRET_B32, "12345", now), null);
    assert.equal(verifyTotp(RFC_SECRET_B32, "abcdef", now), null);
  });

  it("refuses replay of an accepted step", async () => {
    const { verifyTotp, totpAt, totpStep } = await load();
    const now = 1_800_000_000_000;
    const code = totpAt(RFC_SECRET_B32, now);
    assert.equal(verifyTotp(RFC_SECRET_B32, code, now, totpStep(now)), null);
  });

  it("generated secrets round-trip and otpauth URI is well formed", async () => {
    const { generateTotpSecret, base32Decode, base32Encode, otpauthUri } = await load();
    const s = generateTotpSecret();
    assert.match(s, /^[A-Z2-7]{32}$/);
    assert.equal(base32Encode(base32Decode(s)), s);
    const uri = otpauthUri(s, "alvin", "Scalers Admin");
    assert.match(uri, /^otpauth:\/\/totp\/Scalers%20Admin%3Aalvin\?/);
    assert.match(uri, /period=30/);
    assert.match(uri, /digits=6/);
  });
});

describe("secret at rest", () => {
  it("AES-GCM round trip; wrong key fails; short key refused", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const blob = encryptSecret("JBSWY3DPEHPK3PXP", "k".repeat(32));
    assert.doesNotMatch(blob, /JBSWY3DPEHPK3PXP/);
    assert.equal(decryptSecret(blob, "k".repeat(32)), "JBSWY3DPEHPK3PXP");
    assert.throws(() => decryptSecret(blob, "x".repeat(32)));
    assert.throws(() => encryptSecret("x", "short"));
  });
});

describe("backup codes", () => {
  it("10 unique codes, stored hashed, each matches once", async () => {
    const { generateBackupCodes, hashBackupCode, matchBackupCode } = await load();
    const pepper = "p".repeat(32);
    const codes = generateBackupCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    const rows = codes.map((c) => ({ code_hash: hashBackupCode(c, pepper), used_at: null }));
    assert.ok(rows.every((r, i) => !r.code_hash.includes(codes[i].replace("-", ""))));
    const idx = matchBackupCode(codes[3].toUpperCase(), rows, pepper);
    assert.equal(idx, 3);
    rows[idx].used_at = new Date().toISOString();
    assert.equal(matchBackupCode(codes[3], rows, pepper), -1, "single use");
    assert.equal(matchBackupCode("zzzzz-zzzzz", rows, pepper), -1);
  });

  it("consume is atomic on used_at is null", () => {
    const store = read("dashboard/src/lib/ops/stepUpStore.ts");
    assert.match(store, /consumeBackupCode[\s\S]*?\.is\("used_at", null\)/);
  });
});

describe("lockout", () => {
  it("5 wrong codes lock for 15 minutes; success clears", async () => {
    const { afterFailure, afterSuccess, isLocked, LOCK_MS } = await load();
    const now = 1_000_000;
    let s = { failedCount: 0, lockedUntil: null };
    for (let i = 1; i <= 4; i += 1) {
      s = afterFailure(s, now);
      assert.equal(s.justLocked, false);
      assert.equal(isLocked(s, now), false);
    }
    s = afterFailure(s, now);
    assert.equal(s.justLocked, true);
    assert.equal(s.lockedUntil, now + LOCK_MS);
    assert.equal(LOCK_MS, 15 * 60 * 1000);
    assert.equal(isLocked(s, now + LOCK_MS - 1), true);
    assert.equal(isLocked(s, now + LOCK_MS), false);
    assert.deepEqual(afterSuccess(), { failedCount: 0, lockedUntil: null });
  });
});

describe("server gate", () => {
  it("rejects risky writes without a live unlock when enforced", async () => {
    const { gateDecision, UNLOCK_TTL_MS } = await load();
    const now = 5_000_000;
    const base = { enforced: true, actionKey: "invoice:void", operator: "alvin", nowMs: now };
    assert.deepEqual(gateDecision({ ...base, grant: null }), { ok: false, status: 403, error: "step_up_required" });
    assert.deepEqual(gateDecision({ ...base, grant: { operator: "alvin", expiresAt: now - 1 } }).ok, false);
    assert.deepEqual(gateDecision({ ...base, grant: { operator: "other", expiresAt: now + 1000 } }).ok, false);
    assert.deepEqual(gateDecision({ ...base, grant: { operator: "alvin", expiresAt: now + UNLOCK_TTL_MS } }), { ok: true });
    assert.deepEqual(gateDecision({ ...base, enforced: false, grant: null }), { ok: true });
    assert.deepEqual(gateDecision({ ...base, actionKey: "invoice:resend", grant: null }), { ok: true });
    assert.equal(UNLOCK_TTL_MS, 10 * 60 * 1000);
  });

  it("flag is exactly `on`", async () => {
    const { stepUpEnforced } = await load();
    assert.equal(stepUpEnforced({}), false);
    assert.equal(stepUpEnforced({ ADMIN_STEP_UP_ENFORCE: "ON" }), false);
    assert.equal(stepUpEnforced({ ADMIN_STEP_UP_ENFORCE: "1" }), false);
    assert.equal(stepUpEnforced({ ADMIN_STEP_UP_ENFORCE: "on" }), true);
  });

  it("covers Release, Archive, void, credit note, number move", async () => {
    const { isRiskyAction } = await load();
    for (const k of ["did-pool:release", "businesses:release_did", "businesses:archive", "invoice:void", "invoice:credit_note", "did-pool:assign_specific", "businesses:transfer_owner"]) {
      assert.ok(isRiskyAction(k), k);
    }
  });

  it("every risky route calls the gate before writing", () => {
    const routes = {
      "dashboard/src/app/api/did-pool/route.ts": "stepUpGate(",
      "dashboard/src/app/api/admin/businesses/route.ts": "stepUpGate(",
      "dashboard/src/app/api/admin/number-hold/route.ts": "stepUpGate(",
      "dashboard/src/app/api/admin/billing/invoices/[id]/actions/route.ts": "stepUpGate(",
      "dashboard/src/app/api/admin/billing/route.ts": "stepUpGateSession(",
      "dashboard/src/app/api/admin/package-versions/route.ts": "stepUpGateSession(",
      "dashboard/src/app/api/admin/platform-ops/route.ts": "stepUpGateSession(",
    };
    for (const [rel, call] of Object.entries(routes)) {
      const src = read(rel);
      const post = src.slice(src.indexOf("export async function POST"));
      const at = post.indexOf(call);
      assert.ok(at > 0, rel);
      assert.match(post.slice(at, at + 200), /if \(stepUp\) return stepUp;/, rel);
      const markers = rel.includes("package-versions") ? ["runEditorCommand("] : ["try {", "if (action ==="];
      const firstWrite = markers.map((m) => post.indexOf(m)).filter((i) => i >= 0);
      assert.ok(firstWrite.length && at < Math.min(...firstWrite), `${rel}: gate before writes`);
    }
    const gate = read("dashboard/src/lib/ops/stepUpGate.ts");
    assert.match(gate, /admin\.step_up\.blocked/);
    assert.match(gate, /UNLOCK_COOKIE/);
  });
});

describe("reset", () => {
  it("needs a reason and the actor's own unlock; never self", async () => {
    const { validateResetReason } = await load();
    assert.equal(validateResetReason(""), null);
    assert.equal(validateResetReason("  a "), null);
    assert.equal(validateResetReason("lost phone"), "lost phone");
    const route = read("dashboard/src/app/api/admin/step-up/reset/route.ts");
    assert.match(route, /validateResetReason/);
    assert.match(route, /grantValid\(grant, gate\.operator/);
    assert.match(route, /target === gate\.operator/);
    assert.match(route, /sendStepUpNotice\("authenticator_reset"/);
  });

  it("SQL: idempotent, service_role only, reset needs actor + reason and audits", () => {
    const sql = read("docs/supabase/admin_step_up.sql");
    assert.match(sql, /create table if not exists public\.admin_step_up_factor/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on function public\.admin_step_up_reset\(text, text, text\) from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.admin_step_up_reset\(text, text, text\) to service_role/);
    assert.match(sql, /reason required/);
    assert.match(sql, /actor required/);
    assert.match(sql, /'admin\.2fa\.reset'/);
    assert.doesNotMatch(sql, /254709221536|Done and Dusted/);
    const down = read("docs/supabase/admin_step_up_down.sql");
    assert.match(down, /drop function if exists public\.admin_step_up_reset/);
  });
});

describe("audit + UI", () => {
  it("unlock route audits verified, failed, locked, backup use", () => {
    const route = read("dashboard/src/app/api/admin/step-up/route.ts");
    for (const a of ["admin.step_up.verified", "admin.step_up.failed", "admin.step_up.locked", "admin.2fa.backup_code_used"]) {
      assert.ok(route.includes(a), a);
    }
    assert.match(route, /sendStepUpNotice\("backup_code_used"/);
    const enrol = read("dashboard/src/app/api/admin/step-up/enrol/route.ts");
    assert.match(enrol, /admin\.2fa\.enrolled/);
    assert.match(enrol, /encryptSecret/);
  });

  it("StepUpSheet uses the shared Drawer (bottom sheet / side drawer), no centred modal", () => {
    const sheet = read("dashboard/src/components/ops/StepUpSheet.tsx");
    assert.match(sheet, /from "\.\/Drawer"/);
    assert.doesNotMatch(sheet, /Dialog|Modal/);
    assert.match(sheet, /Use a backup code/);
    assert.match(sheet, /won&apos;t be shown again/);
  });

  it("backup codes: shown once with Download + Copy, never emailed", () => {
    const sheet = read("dashboard/src/components/ops/StepUpSheet.tsx");
    assert.match(sheet, /Download \(\.txt\)/);
    assert.match(sheet, /navigator\.clipboard\.writeText/);
    assert.match(sheet, /password manager or print them/);
    assert.match(sheet, /never email backup codes/);
    const store = read("dashboard/src/lib/ops/stepUpStore.ts");
    assert.match(store, /redactStepUpCodes\(extra\)/);
    for (const r of ["dashboard/src/app/api/admin/step-up/route.ts", "dashboard/src/app/api/admin/step-up/reset/route.ts", "dashboard/src/app/api/admin/step-up/enrol/route.ts"]) {
      const src = read(r);
      for (const m of src.matchAll(/sendStepUpNotice\(([^;]*)\);/g)) {
        assert.doesNotMatch(m[1], /backupCode|codes|\bcode\b/i, r);
      }
    }
  });
});
