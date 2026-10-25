/**
 * Super Admin A0 safety:
 * - no supplier, vendor, or infra names in admin error copy;
 * - a number live on an active business can't be released (server and UI);
 * - Remove is Archive; no hard delete from Admin (purge rules: adminLifecycle.test.js);
 * - admin writes record the signed-in operator, never a typed name or "ops";
 * - confirms are ConfirmSheet bottom drawers, never window.confirm or a centred dialog.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  hasVendorOrInfraName,
  operatorMessage,
  plainServiceDetail,
  adminFacingError,
} = require("../dashboard/src/lib/adminErrors.ts");
const {
  ARCHIVE_RESTORE_DAYS,
  releaseBlockReason,
  AdminActionBlocked,
  isAdminActionBlocked,
} = require("../dashboard/src/lib/adminBusinessModel.ts");
const { actorFromSession, SHARED_LOGIN_ACTOR } = require("../dashboard/src/lib/adminActorModel.ts");

const root = path.join(__dirname, "..");
const DASH = "dashboard/src";
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const API_FILES = [...walk(`${DASH}/app/api/admin`), `${DASH}/app/api/did-pool/route.ts`];
const ADMIN_COMPONENTS = fs
  .readdirSync(path.join(root, `${DASH}/components`))
  .filter((name) => /^(Admin|BuyNumber|DidPool|PlatformRunBoard)/.test(name) && name.endsWith(".tsx"))
  .map((name) => `${DASH}/components/${name}`);
const ADMIN_PAGES = walk(`${DASH}/app/admin`);

/** String literals that end up on screen: error values, JSX text, and copy props. */
function screenStrings(src) {
  const out = [];
  const patterns = [
    /error:\s*"([^"]*)"/g,
    /error:\s*`([^`]*)`/g,
    /(?:title|preview|line|description|confirmLabel|label|hint|detail|placeholder)=\s*"([^"]*)"/g,
    /(?:title|detail|message):\s*"([^"]*)"/g,
    />[ \t]*([A-Za-z][^<>{}()=;\n]*?)[ \t]*</g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) out.push(m[1]);
  }
  return out.filter((t) => t && t.trim());
}

describe("A0: supplier, vendor, and infra names stay off screen", () => {
  it("detects the names that used to leak", () => {
    for (const leak of [
      "SAUTIKIT_API_KEY is not set on the dashboard server.",
      "Mint Key B (SAUTIKIT_ADMIN_OPS_KEY) with numbers.claim on Vercel.",
      "Could not read Resend.",
      "Soniox 402 payment required",
      "Gemini quota exceeded",
      "PGRST205 relation does not exist",
    ]) {
      assert.equal(hasVendorOrInfraName(leak), true, leak);
    }
    assert.equal(hasVendorOrInfraName("No available numbers in the pool"), false);
  });

  it("maps upstream errors to plain operator copy", () => {
    const cases = [
      "SAUTIKIT_API_KEY is not set on the dashboard server.",
      "Buying requires SAUTIKIT_ADMIN_OPS_KEY (or SAUTIKIT_API_KEY) with numbers.claim scope.",
      "api_key.scope_denied: numbers.claim",
      "SautiKit: insufficient wallet balance",
      "fetch failed (ECONNREFUSED api.sautikit.com)",
      "Resend 429 rate limit",
      "Supabase error: something odd",
    ];
    for (const raw of cases) {
      const out = operatorMessage(raw, "Could not save.");
      assert.equal(hasVendorOrInfraName(out), false, `${raw} -> ${out}`);
    }
    assert.match(operatorMessage("insufficient balance", "x"), /Out of credit/);
    assert.match(operatorMessage("api_key.scope_denied", "x"), /refused/);
    assert.equal(operatorMessage("Supabase error: something odd", "Could not save."), "Could not save.");
    assert.equal(adminFacingError("Vercel env missing", "Could not save."), "Could not save.");
    assert.equal(operatorMessage("No available numbers in the pool", "x"), "No available numbers in the pool");
  });

  it("Platform row details never echo upstream text", () => {
    for (const raw of ["Soniox: 402 balance exhausted", "Gemini API key invalid", "SautiKit timeout", "weird thing"]) {
      const out = plainServiceDetail(raw);
      assert.equal(hasVendorOrInfraName(out), false, out);
      assert.ok(!out.includes(raw));
    }
    const model = read(`${DASH}/lib/platformRunBoardModel.ts`);
    assert.doesNotMatch(model, /detail:\s*snap\.lastError\.message\b/);
    assert.doesNotMatch(model, /detail:\s*telecom\.message\b/);
    assert.doesNotMatch(model, /\?\s*voice\.message\b/);
  });

  it("admin API routes never return raw error text, key diagnostics, or vendor copy", () => {
    const leaks = [];
    for (const rel of API_FILES) {
      const src = read(rel);
      if (/error:\s*message\b/.test(src) || /error:\s*`\$\{message\}/.test(src)) leaks.push(`${rel}: raw message`);
      if (/NextResponse\.json\([^)]*diagnostics/s.test(src)) leaks.push(`${rel}: diagnostics in response`);
      for (const text of screenStrings(src)) {
        if (hasVendorOrInfraName(text)) leaks.push(`${rel}: ${text}`);
      }
    }
    assert.deepEqual(leaks, []);
  });

  it("admin screens carry no vendor or infra names in their copy", () => {
    const leaks = [];
    for (const rel of [...ADMIN_COMPONENTS, ...ADMIN_PAGES]) {
      for (const text of screenStrings(read(rel))) {
        if (hasVendorOrInfraName(text)) leaks.push(`${rel}: ${text}`);
      }
    }
    assert.deepEqual(leaks, []);
  });
});

describe("A0: a live number can't be released", () => {
  it("blocks release on an active business, allows it once archived or unlinked", () => {
    assert.match(releaseBlockReason({ linked: true, businessName: "Aris", isActive: true }), /Live on Aris\. Archive/);
    assert.match(releaseBlockReason({ linked: true, businessName: "Aris", isActive: null }), /Live on Aris/);
    assert.equal(releaseBlockReason({ linked: true, businessName: "Aris", isActive: false }), null);
    assert.equal(releaseBlockReason({ linked: false }), null);
  });

  it("the server checks before either release RPC runs and answers 409", () => {
    const actions = read(`${DASH}/lib/adminBusinessActions.ts`);
    for (const fn of ["releaseBusinessNumber", "releasePoolNumber"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
      const check = body.indexOf("assertReleasable(");
      const rpc = body.indexOf('rpc("release_did_from_business"');
      assert.ok(check > 0 && rpc > check, `${fn} must check before the RPC`);
    }
    for (const rel of [`${DASH}/app/api/admin/businesses/route.ts`, `${DASH}/app/api/did-pool/route.ts`]) {
      const src = read(rel);
      assert.match(src, /isAdminActionBlocked\(err\)/, rel);
      assert.match(src, /status: 409/, rel);
    }
    // The old unguarded helpers are gone, so nothing can bypass the check.
    assert.doesNotMatch(read(`${DASH}/lib/didPool.ts`), /releaseAssignedDid/);
    assert.doesNotMatch(read(`${DASH}/lib/admin.ts`), /releaseDidFromBusiness|removeBusinessAndReleaseDid/);
    const blocked = new AdminActionBlocked("x");
    assert.equal(isAdminActionBlocked(blocked), true);
    assert.equal(isAdminActionBlocked(new Error("x")), false);
  });

  it("Businesses and Numbers show a disabled Release with the reason", () => {
    for (const rel of [`${DASH}/components/AdminShopPanel.tsx`, `${DASH}/components/DidPoolManager.tsx`]) {
      const src = read(rel);
      assert.match(src, /releaseBlockReason|releaseReason/, rel);
      assert.match(src, /disabled\s*\n\s*(title=[^\n]*\n\s*)?aria-describedby=\{`release-why-/, rel);
    }
  });
});

describe("A0: Remove is Archive, and Admin has no hard delete", () => {
  it("keeps a 30 day restore window", () => {
    assert.equal(ARCHIVE_RESTORE_DAYS, 30);
  });

  it("the one-step remove and the permanent delete are gone", () => {
    const actions = read(`${DASH}/lib/adminBusinessActions.ts`);
    assert.doesNotMatch(actions, /remove_business_and_release_did/);
    assert.doesNotMatch(actions, /deleteArchivedBusiness/);
    const route = read(`${DASH}/app/api/admin/businesses/route.ts`);
    assert.doesNotMatch(route, /action === "remove"/);
    assert.doesNotMatch(route, /action === "delete_permanently"/);
    assert.match(route, /action === "archive"/);
    assert.match(route, /action === "restore"/);
    assert.doesNotMatch(read(`${DASH}/components/AdminBusinessesPanel.tsx`), /Delete permanently|delete_permanently/);
  });

  it("works before the archive SQL exists", () => {
    const actions = read(`${DASH}/lib/adminBusinessActions.ts`);
    assert.match(actions, /isMissingArchiveColumn/);
    assert.match(read(`${DASH}/lib/admin.ts`), /"archived_at"/);
    assert.match(read("docs/supabase/admin_business_archive.sql"), /add column if not exists archived_at timestamptz/);
  });
});

describe("A0: the signed-in Super Admin is the actor", () => {
  it("reads the session username, never a fallback of ops", () => {
    assert.equal(actorFromSession({ user: { name: "kigen" } }), "kigen");
    assert.equal(actorFromSession({ user: { name: "  " } }), SHARED_LOGIN_ACTOR);
    assert.equal(actorFromSession(null), SHARED_LOGIN_ACTOR);
    assert.notEqual(SHARED_LOGIN_ACTOR, "ops");
  });

  it("admin write routes take the actor from the session, not the body", () => {
    for (const rel of [
      `${DASH}/app/api/admin/billing/route.ts`,
      `${DASH}/app/api/admin/wallets/route.ts`,
      `${DASH}/app/api/admin/businesses/route.ts`,
      `${DASH}/app/api/did-pool/route.ts`,
    ]) {
      const src = read(rel);
      assert.match(src, /adminActorName\(\)/, rel);
      assert.doesNotMatch(src, /body\.actor/, rel);
      assert.doesNotMatch(src, /\|\| "ops"/, rel);
    }
  });

  it("the Businesses screen no longer sends a hard-coded actor", () => {
    assert.doesNotMatch(read(`${DASH}/components/AdminBusinessesPanel.tsx`), /actor:/);
  });

  it("suspend, restore line, archive, unarchive, and release write an audit row with that actor", () => {
    const actions = read(`${DASH}/lib/adminBusinessActions.ts`);
    for (const action of ["suspend_business", "unsuspend_business", "archive_business", "restore_business", "release_number"]) {
      assert.match(actions, new RegExp(`action: "${action}"`), action);
    }
    assert.match(read(`${DASH}/lib/adminAudit.ts`), /from\("ops_audit_log"\)/);
  });
});

describe("A0: confirms are ConfirmSheet bottom drawers", () => {
  it("no window.confirm or centred dialog anywhere in admin", () => {
    for (const rel of [...ADMIN_COMPONENTS, ...ADMIN_PAGES]) {
      const src = read(rel);
      assert.doesNotMatch(src, /window\.confirm|\bconfirm\(/, rel);
      assert.doesNotMatch(src, /DeskDialog/, rel);
    }
  });

  it("release and every lifecycle action confirm in a ConfirmSheet", () => {
    const biz = read(`${DASH}/components/AdminShopPanel.tsx`);
    const rel = biz.indexOf('title="Release this number?"');
    assert.ok(rel > 0);
    const opener = biz.lastIndexOf("<", biz.lastIndexOf("open={", rel));
    assert.equal(biz.slice(opener, opener + 13), "<ConfirmSheet");
    const life = biz.indexOf('open={sheet === "lifecycle"}');
    assert.ok(life > 0);
    assert.equal(biz.slice(biz.lastIndexOf("<", life), biz.lastIndexOf("<", life) + 13), "<ConfirmSheet");
    for (const title of ["Suspend this line?", "Restore this line?", "Archive this business?", "Unarchive this business?"]) {
      assert.ok(biz.includes(`title: "${title}"`), title);
    }
    const pool = read(`${DASH}/components/DidPoolManager.tsx`);
    const at = pool.indexOf('title="Release this number?"');
    assert.equal(pool.slice(pool.lastIndexOf("<ConfirmSheet", at), pool.lastIndexOf("<ConfirmSheet", at) + 13), "<ConfirmSheet");
    assert.ok(pool.lastIndexOf("<ConfirmSheet", at) > pool.lastIndexOf("<Sheet", at));
  });
});

describe("A0: operator-only writes + step-up observe (s21)", () => {
  const writeRoutes = [
    `${DASH}/app/api/did-pool/route.ts`,
    `${DASH}/app/api/admin/businesses/route.ts`,
  ];

  it("POST write routes require a Better Auth operator and reject the legacy cookie alone", () => {
    for (const rel of writeRoutes) {
      const src = read(rel);
      assert.match(src, /requireAdminOperatorWrite/, rel);
      // POST must not lean on isLegacyAuthenticated (HMAC cookie still allowed on GET reads).
      const post = src.slice(src.indexOf("export async function POST"));
      assert.match(post, /requireAdminOperatorWrite/, rel);
      assert.doesNotMatch(post, /isLegacyAuthenticated/, `${rel} POST must not accept the legacy cookie`);
      assert.match(post, /gate\.status/, rel);
    }
    const guard = read(`${DASH}/lib/adminOperatorWrite.ts`);
    assert.match(guard, /getAdminSession/);
    assert.match(guard, /findAdminOperator/);
    assert.match(guard, /Sign in as an operator/);
  });

  it("step-up observe is called before the write and enforce is not wired", () => {
    const step = read(`${DASH}/lib/ops/stepUp.ts`);
    assert.match(step, /ADMIN_STEP_UP/);
    assert.match(step, /would-require-step-up/);
    assert.match(step, /not implemented/);
    for (const rel of writeRoutes) {
      const src = read(rel);
      const post = src.slice(src.indexOf("export async function POST"));
      assert.match(post, /requireStepUp\(/, rel);
      const stepAt = post.indexOf("requireStepUp(");
      const markers = ["addDidToPool", "assign_did_from_pool", "releasePoolNumber", "releaseBusinessNumber", "assign_specific_did", "suspendBusiness"];
      const writeAt = Math.min(
        ...markers.map((n) => {
          const i = post.indexOf(n);
          return i < 0 ? Number.POSITIVE_INFINITY : i;
        }),
      );
      assert.ok(stepAt >= 0 && stepAt < writeAt, `${rel}: requireStepUp before write`);
    }
  });

  it("Numbers v2 Unlock is honest; Assign/Release/Hold use OpsConfirm + number-hold API", () => {
    const ui = read(`${DASH}/components/admin/v2/AdminNumbersV2.tsx`);
    assert.match(ui, /OpsConfirm/);
    assert.match(ui, /data-honest="unlock"|UnlockCta/);
    assert.match(ui, /\/api\/admin\/number-hold/);
    assert.match(ui, /data-hold-choice/);
    assert.match(ui, /confirmLabel="Assign number"/);
    assert.match(ui, /Release number|Release and hold/);
    assert.match(ui, /UnlockCta/);
    assert.doesNotMatch(ui, /showHonest\(/);
  });
});
