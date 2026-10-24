/**
 * Unlock grant end to end, from one registry (Alvin 24 Oct 2026).
 * - Every mutating route under app/api/admin + app/api/did-pool is classified in ADMIN_WRITE_ROUTES.
 * - Every action a route handles is classified risky or safe; risky ones are gated before any branch runs.
 * - For every risky key: no unlock → 403 step_up_required; live unlock → proceeds; after 10 min → 403.
 * - The UI catch-all (StepUpHost) is mounted and names every risky key, so no gated button is dead.
 * - Sign-in 2FA helpers: device cookie, email code, rate limit, recipient.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const api = path.join(root, "dashboard/src/app/api");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/stepUpCore.ts"));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}
const MUTATING = /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b|export\s+const\s+(POST|PUT|PATCH|DELETE)\b/;
const mutatingRoutes = () =>
  [...walk(path.join(api, "admin")), ...walk(path.join(api, "did-pool"))]
    .filter((f) => MUTATING.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(api, path.dirname(f)).split(path.sep).join("/"))
    .sort();

function actionLiterals(src) {
  const found = new Set();
  for (const m of src.matchAll(/\baction\s*===\s*"([a-z_]+)"/g)) found.add(m[1]);
  for (const m of src.matchAll(/\bcase\s+"([a-z_]+)"\s*:/g)) found.add(m[1]);
  return found;
}

describe("route registry", () => {
  it("every mutating admin route is classified (add new routes to ADMIN_WRITE_ROUTES)", async () => {
    const { ADMIN_WRITE_ROUTES } = await load();
    const listed = new Set(ADMIN_WRITE_ROUTES.map((r) => r.file));
    const missing = mutatingRoutes().filter((f) => !listed.has(f));
    assert.deepEqual(missing, [], `unclassified mutating admin routes: ${missing.join(", ")}`);
    for (const r of ADMIN_WRITE_ROUTES) assert.ok(fs.existsSync(path.join(api, r.file, "route.ts")), `registry lists missing route ${r.file}`);
  });

  it("every action a route handles is classified risky or safe", async () => {
    const { ADMIN_WRITE_ROUTES } = await load();
    for (const r of ADMIN_WRITE_ROUTES) {
      if (r.kind) continue;
      const src = fs.readFileSync(path.join(api, r.file, "route.ts"), "utf8");
      const known = new Set([...r.risky, ...r.safe]);
      for (const a of actionLiterals(src)) assert.ok(known.has(a), `${r.file}: action "${a}" is not classified`);
      for (const a of r.risky) assert.ok(actionLiterals(src).has(a), `${r.file}: risky "${a}" not handled in source`);
    }
  });

  it("routes with risky actions call the server gate with their prefix, before the first action branch", async () => {
    const { ADMIN_WRITE_ROUTES } = await load();
    for (const r of ADMIN_WRITE_ROUTES.filter((x) => x.risky.length)) {
      const src = fs.readFileSync(path.join(api, r.file, "route.ts"), "utf8");
      const gateRe = r.kind === "single"
        ? new RegExp(`stepUpGate(Session)?\\([^)]*"${r.prefix}:${r.risky[0]}"`)
        : new RegExp(`stepUpGate(Session)?\\([^)]*\`${r.prefix}:\\$\\{`);
      const m = gateRe.exec(src);
      assert.ok(m, `${r.file}: no stepUpGate call for ${r.prefix}`);
      assert.match(src.slice(m.index, m.index + 400), /if \(stepUp\) return stepUp;/, `${r.file}: gate result not returned`);
      if (!r.kind) {
        const firstBranch = Math.min(...r.risky.map((a) => {
          const i = src.search(new RegExp(`(if \\(|command\\.)action === "${a}"|case "${a}"`));
          return i < 0 ? Infinity : i;
        }));
        // package-versions parses commands (case …) and pre-reads before the gate; the write itself (runEditorCommand) runs after.
        if (r.file === "admin/package-versions") assert.ok(m.index < src.indexOf("await runEditorCommand(actor"), "package-versions: gate before the write");
        else assert.ok(m.index < firstBranch, `${r.file}: gate must run before the action branches`);
      }
      // audit: each risky route writes ops_audit_log itself or via an RPC that does.
      assert.match(src, /recordAdminAction|auditStepUp|resetFactor|\.rpc\(|audit|Audit|lib\/admin/i, `${r.file}: no audit path`);
    }
  });
});

describe("unlock grant for every risky action", () => {
  it("403 without unlock, proceeds with a live unlock, re-asks after 10 min, never on another operator's unlock", async () => {
    const { riskyActionKeys, gateDecision, UNLOCK_TTL_MS, isRiskyAction } = await load();
    const keys = riskyActionKeys();
    const expected = [
      "did-pool:release", "did-pool:assign_specific", "did-pool:assign_next",
      "businesses:release_did", "businesses:archive", "businesses:transfer_owner", "businesses:assign_next",
      "invoice:void", "invoice:credit_note",
      "number-hold:hold", "number-hold:end_hold", "number-hold:restore", "number-hold:set_settings", "number-hold:bill_fee",
      "package-versions:publish", "package-versions:move_subscribers", "package-versions:set_billing_mode",
      "billing:grant_minutes", "billing:assign_package", "billing:resolve_checkout_review", "billing:set_billing_mode",
      "wallets:set_billing_mode", "platform-ops:save_settings", "step-up:reset", "step-up:regenerate_backup_codes",
    ];
    for (const k of expected) assert.ok(keys.includes(k), `missing risky key ${k}`);
    const t0 = 1_800_000_000_000;
    const grant = { operator: "alvin", expiresAt: t0 + UNLOCK_TTL_MS };
    for (const actionKey of keys) {
      assert.ok(isRiskyAction(actionKey));
      const base = { enforced: true, actionKey, operator: "alvin" };
      assert.deepEqual(gateDecision({ ...base, grant: null, nowMs: t0 }), { ok: false, status: 403, error: "step_up_required" }, actionKey);
      assert.deepEqual(gateDecision({ ...base, grant, nowMs: t0 + 1 }), { ok: true }, actionKey);
      assert.deepEqual(gateDecision({ ...base, grant, nowMs: t0 + UNLOCK_TTL_MS - 1 }), { ok: true }, actionKey);
      assert.equal(gateDecision({ ...base, grant, nowMs: t0 + UNLOCK_TTL_MS }).ok, false, `${actionKey} must re-ask at 10 min`);
      assert.equal(gateDecision({ ...base, operator: "mercy", grant, nowMs: t0 + 1 }).ok, false, `${actionKey}: grant is per operator`);
      assert.deepEqual(gateDecision({ ...base, enforced: false, grant: null, nowMs: t0 }), { ok: true }, `${actionKey}: flag off = today's behaviour`);
    }
    assert.equal(UNLOCK_TTL_MS, 10 * 60 * 1000);
  });

  it("the 403 body carries the action key so the UI can open the sheet for it", () => {
    const gate = read("dashboard/src/lib/ops/stepUpGate.ts");
    assert.match(gate, /error: d\.error, message: [^}]*action: actionKey/);
  });

  it("UI catch-all: StepUpHost is mounted in the console layout and names every risky key", async () => {
    const { riskyActionKeys } = await load();
    const layout = read("dashboard/src/app/admin/(console)/layout.tsx");
    assert.match(layout, /<StepUpHost \/>/);
    const host = read("dashboard/src/components/ops/StepUpHost.tsx");
    assert.match(host, /res\.status === 403/);
    assert.match(host, /step_up_required/);
    assert.match(host, /STEP_UP_WHAT/);
    const words = read("dashboard/src/lib/ops/stepUpWords.ts");
    for (const k of riskyActionKeys()) assert.ok(words.includes(`"${k}"`), `stepUpWords has no plain-language name for ${k}`);
  });
});

describe("sign-in 2FA", () => {
  const key = "k".repeat(32);
  it("device cookie: bound to operator, 12 h, tamper-proof", async () => {
    const { signDeviceToken, verifyDeviceToken, SIGNIN_REMEMBER_MS } = await load();
    const now = 1_800_000_000_000;
    const t = signDeviceToken("alvin", now + SIGNIN_REMEMBER_MS, key);
    assert.equal(SIGNIN_REMEMBER_MS, 12 * 60 * 60 * 1000);
    assert.equal(verifyDeviceToken(t, "alvin", now, key), true);
    assert.equal(verifyDeviceToken(t, "mercy", now, key), false);
    assert.equal(verifyDeviceToken(t, "alvin", now + SIGNIN_REMEMBER_MS, key), false, "expires at 12 h");
    assert.equal(verifyDeviceToken(t, "alvin", now, "x".repeat(32)), false, "other key");
    assert.equal(verifyDeviceToken(t.slice(0, -2) + "AA", "alvin", now, key), false, "tampered mac");
    const far = signDeviceToken("alvin", now + 10 * SIGNIN_REMEMBER_MS, key);
    assert.equal(verifyDeviceToken(far, "alvin", now, key), false, "no long-lived tokens");
    assert.equal(verifyDeviceToken(undefined, "alvin", now, key), false);
  });

  it("email code: 6 digits, hashed, single use, 10-minute expiry", async () => {
    const { generateEmailCode, hashEmailCode, matchEmailCode, EMAIL_CODE_TTL_MS } = await load();
    const now = 1_800_000_000_000;
    const c = generateEmailCode();
    assert.match(c, /^\d{6}$/);
    const rows = [{ code_hash: hashEmailCode(c, "alvin", key), used_at: null, expires_at: new Date(now + EMAIL_CODE_TTL_MS).toISOString() }];
    assert.ok(!rows[0].code_hash.includes(c));
    assert.equal(matchEmailCode(c, "alvin", rows, key, now), 0);
    assert.equal(matchEmailCode(c, "mercy", rows, key, now), -1, "bound to operator");
    assert.equal(matchEmailCode(c, "alvin", rows, key, now + EMAIL_CODE_TTL_MS), -1, "expired");
    rows[0].used_at = new Date(now).toISOString();
    assert.equal(matchEmailCode(c, "alvin", rows, key, now), -1, "single use");
    assert.equal(EMAIL_CODE_TTL_MS, 10 * 60 * 1000);
  });

  it("email send rate limit: 1 per 60 s, 5 per hour", async () => {
    const { emailSendDecision } = await load();
    const now = 1_800_000_000_000;
    assert.deepEqual(emailSendDecision([], now), { ok: true });
    assert.equal(emailSendDecision([now - 30_000], now).ok, false);
    assert.equal(emailSendDecision([now - 61_000], now).ok, true);
    const five = [1, 2, 3, 4, 5].map((i) => now - i * 5 * 60_000);
    const d = emailSendDecision(five, now);
    assert.equal(d.ok, false);
    assert.ok(d.retryAfterS > 0);
    assert.equal(emailSendDecision(five.map((t) => t - 60 * 60_000), now).ok, true, "old sends drop out");
  });

  it("email goes to the operator's own address when set, else ADMIN_STEP_UP_ALERT_EMAIL", async () => {
    const { signInEmailFor, maskEmail } = await load();
    const env = { ADMIN_OPERATOR_EMAILS: "mercy:mercy@example.com", ADMIN_STEP_UP_ALERT_EMAIL: "scalersventures@gmail.com, x@y.co" };
    assert.equal(signInEmailFor("mercy", env), "mercy@example.com");
    assert.equal(signInEmailFor("alvin", env), "scalersventures@gmail.com");
    assert.equal(signInEmailFor("alvin", {}), null);
    assert.equal(maskEmail("scalersventures@gmail.com"), "s******@gmail.com");
  });

  it("wiring: same flag, session needs the device cookie, legacy cookie refused, codes never logged", () => {
    const auth = read("dashboard/src/lib/auth.ts");
    assert.match(auth, /getAdminSessionRaw/);
    assert.match(auth, /signInTwoFactorRequired\(\)\) return false/);
    assert.match(read("dashboard/src/lib/ops/stepUpCore.ts"), /signInTwoFactorRequired[\s\S]{0,200}stepUpEnforced\(env\)/);
    const session = read("dashboard/src/app/api/admin/session/route.ts");
    assert.match(session, /\/admin\/login\?step=2fa/);
    const route = read("dashboard/src/app/api/admin/sign-in-2fa/route.ts");
    for (const ev of ["admin.2fa.sign_in.verified", "admin.2fa.sign_in.failed", "admin.2fa.sign_in.email_sent", "admin.2fa.sign_in.locked"]) assert.ok(route.includes(ev), ev);
    assert.doesNotMatch(route, /console\.(log|info|error)\([^)]*code/i);
    assert.doesNotMatch(route, /auditStepUp\([^)]*\bcode\b(?!_)/);
    assert.match(route, /httpOnly: true/);
    const ui = read("dashboard/src/components/admin/AdminSignInTwoFactor.tsx");
    assert.match(ui, /autoComplete="one-time-code"/);
    assert.match(ui, /inputMode=\{mode === "backup" \? "text" : "numeric"\}/);
    assert.match(ui, /Use email code instead/);
    assert.match(ui, /Use a backup code/);
  });

  it("SQL migration is idempotent with a down script", () => {
    const up = read("docs/supabase/admin_sign_in_2fa.sql");
    assert.match(up, /create table if not exists public\.admin_sign_in_email_code/);
    assert.match(up, /enable row level security/);
    assert.match(up, /create or replace function public\.admin_step_up_reset/);
    assert.match(read("docs/supabase/admin_sign_in_2fa_down.sql"), /drop table if exists public\.admin_sign_in_email_code/);
  });

  it("logout forgets this device: clears the 12 h cookie and the Unlock, and revokes the grant row", () => {
    const src = read("dashboard/src/app/api/logout/route.ts");
    assert.match(src, /res\.cookies\.set\(SIGNIN_COOKIE, "", \{[^}]*maxAge: 0/);
    assert.match(src, /res\.cookies\.set\(UNLOCK_COOKIE, "", \{[^}]*maxAge: 0/);
    assert.match(src, /await revokeGrant\(request\.cookies\.get\(UNLOCK_COOKIE\)/);
    const store = read("dashboard/src/lib/ops/stepUpStore.ts");
    assert.match(store, /export async function revokeGrant[\s\S]{0,300}revoked_at: new Date\(\)\.toISOString\(\)/);
  });
});

describe("spend and destructive actions", () => {
  it("buy-number and voices delete need Unlock; the named ungated routes are classified safe on purpose", async () => {
    const { ADMIN_WRITE_ROUTES, isRiskyAction } = await import("../dashboard/src/lib/ops/stepUpCore.ts");
    assert.equal(isRiskyAction("buy-number:buy"), true);
    assert.equal(isRiskyAction("voices:delete"), true);
    assert.equal(isRiskyAction("voices:upsert"), false);
    for (const f of ["admin/packages", "admin/billing/flags", "admin/billing/test-invoice", "admin/sautikit-sync"]) {
      const r = ADMIN_WRITE_ROUTES.find((x) => x.file === f);
      assert.ok(r && r.risky.length === 0 && r.safe.length > 0 && /Ungated by decision/.test(r.note || ""), f);
    }
    const buy = read("dashboard/src/app/api/admin/buy-number/route.ts");
    assert.ok(buy.indexOf('stepUpGateSession("buy-number:buy"') < buy.indexOf("buyNumberIntoPool(inventoryId)"), "gate before the purchase");
  });
});

describe("sign-in email failure is honest", () => {
  it("failed send: 502 with the exact message, code retired, audited as email_failed (never email_sent)", async () => {
    const { EMAIL_FAILED_MESSAGE } = await import("../dashboard/src/lib/ops/stepUpCore.ts");
    assert.equal(EMAIL_FAILED_MESSAGE, "We couldn't send the email code. Use your authenticator or a backup code.");
    const route = read("dashboard/src/app/api/admin/sign-in-2fa/route.ts");
    const fail = route.slice(route.indexOf("if (!sent.sent)"), route.indexOf('"admin.2fa.sign_in.email_sent"'));
    assert.match(fail, /retireEmailCodes\(op\)/);
    assert.match(fail, /"admin\.2fa\.sign_in\.email_failed", \{ to: maskEmail\(to\), why:/);
    assert.match(fail, /EMAIL_FAILED_MESSAGE \}, \{ status: 502 \}/);
    assert.doesNotMatch(fail, /emailCode/, "the code never goes in the audit row");
    const ui = read("dashboard/src/components/admin/AdminSignInTwoFactor.tsx");
    const send = ui.slice(ui.indexOf("const sendEmail"), ui.indexOf("const verify"));
    assert.ok(send.indexOf("if (!res.ok) return setMsg") < send.indexOf("setSentTo("), "never shows 'Sent to' after a failure");
  });

  it("an unconfigured mailer reports why instead of a silent no-op", () => {
    const store = read("dashboard/src/lib/ops/stepUpStore.ts");
    assert.match(store, /res\.sent \? \{ sent: true \} : \{ sent: false, why: res\.skipped \}/);
    assert.match(read("dashboard/src/lib/opsMail.ts"), /skipped: "ops_mail_unconfigured"/);
  });
});

describe("Settings › Security tab", () => {
  it("is a Settings tab and a phone More row (not a second desktop rail item), and the page exists", async () => {
    const links = await import("../dashboard/src/lib/adminLinks.ts");
    assert.ok(links.ADMIN_SETTINGS_TABS.some((t) => t.href === "/admin/settings/security" && t.label === "Security"));
    assert.ok(links.adminPhoneMore(true).some((l) => l.href === "/admin/settings/security"));
    assert.match(read("dashboard/src/components/AdminNav.tsx"), /ADMIN_LINKS_V2\.filter\(\(item\) => item\.rail !== false\)/);
    assert.ok(fs.existsSync(path.join(root, "dashboard/src/app/admin/(console)/settings/security/page.tsx")));
  });

  it("has the five sections and every button calls a real route", () => {
    const ui = read("dashboard/src/components/admin/v2/AdminSecurityV2.tsx");
    for (const h of ["Your sign-in", "Backup codes", "Unlock", "Operators", "Recent security activity"]) assert.ok(ui.includes(`>${h}</h2>`), h);
    for (const r of ["/api/admin/step-up/backup-codes", "/api/admin/step-up/reset", "/api/admin/step-up/session"]) {
      assert.ok(ui.includes(r), r);
      assert.ok(fs.existsSync(path.join(api, r.replace("/api/", ""), "route.ts")), `${r} route exists`);
    }
    assert.match(ui, /timeZone: "Africa\/Nairobi"/);
    assert.match(ui, /<OpsConfirm/);
    const page = read("dashboard/src/app/admin/(console)/settings/security/page.tsx");
    assert.match(page, /recentSecurityEvents\(20\)/);
  });

  it("End now revokes the grant; Forget this device clears the device cookie; both audited", () => {
    const src = read("dashboard/src/app/api/admin/step-up/session/route.ts");
    assert.match(src, /await revokeGrant\(jar\.get\(UNLOCK_COOKIE\)/);
    assert.match(src, /res\.cookies\.set\(UNLOCK_COOKIE, "", gone\)/);
    assert.match(src, /res\.cookies\.set\(SIGNIN_COOKIE, "", gone\)/);
    assert.match(src, /"admin\.step_up\.ended"/);
    assert.match(src, /"admin\.2fa\.device_forgotten"/);
  });
});
