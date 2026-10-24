/**
 * Unlock window, end to end against the server step-up check (Alvin, 24 Oct 2026).
 * Real route handlers (step-up, step-up/session, step-up/areas, step-up/duration, logout) and the
 * real stepUpGate → stepUpStore → stepUpCore path run on an in-memory DB with fake time.
 * Fakes: tests/fakes/stepUp (DB, cookie jar, signed-in operator, no email). Run with
 * node --experimental-strip-types --import ./tests/fakes/stepUp/register.mjs --test tests/adminUnlockWindow.test.mjs
 */
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { H } from "./fakes/stepUp/state.mjs";

process.env.ADMIN_STEP_UP_ENFORCE = "on";
process.env.ADMIN_STEP_UP_KEY = "test-step-up-key-0123456789abcdef";
delete process.env.ADMIN_STEP_UP_ALERT_EMAIL;

const core = await import("../dashboard/src/lib/ops/stepUpCore.ts");
const time = await import("../dashboard/src/lib/ops/stepUpTime.ts");
const { stepUpGate } = await import("../dashboard/src/lib/ops/stepUpGate.ts");
const unlockRoute = await import("../dashboard/src/app/api/admin/step-up/route.ts");
const sessionRoute = await import("../dashboard/src/app/api/admin/step-up/session/route.ts");
const areasRoute = await import("../dashboard/src/app/api/admin/step-up/areas/route.ts");
const durationRoute = await import("../dashboard/src/app/api/admin/step-up/duration/route.ts");
const logoutRoute = await import("../dashboard/src/app/api/logout/route.ts");
const { NextRequest } = await import("next/server");

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const T0 = Date.UTC(2026, 9, 24, 9, 0, 0); // 12:00 EAT
const MIN = 60_000;

let clock = T0;
const at = (ms) => { clock = ms; mock.timers.setTime(ms); };
const later = (ms) => at(clock + ms);

beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  clock = T0;
  H.db = {
    admin_step_up_factor: [{
      operator: "alvin", secret_enc: core.encryptSecret(SECRET, process.env.ADMIN_STEP_UP_KEY), pending_secret_enc: null,
      enrolled_at: new Date(T0 - 86_400_000).toISOString(), needs_reenrol: false, failed_count: 0, locked_until: null, last_step: null,
    }],
    admin_step_up_grant: [], admin_step_up_backup_code: [], admin_step_up_area: [], admin_step_up_setting: [], ops_audit_log: [],
  };
  H.jar = new Map();
  H.operator = "alvin";
  H.mail = [];
});
afterEach(() => mock.timers.reset());

/** Apply Set-Cookie the way the browser does (maxAge 0 deletes; maxAge > 0 expires later). */
const expiries = new Map();
function applyCookies(res) {
  for (const c of res.cookies?.list || []) {
    if (!c.value || c.maxAge === 0) { H.jar.delete(c.name); expiries.delete(c.name); continue; }
    H.jar.set(c.name, c.value);
    if (c.maxAge) expiries.set(c.name, Date.now() + c.maxAge * 1000);
  }
}
/** A new page load / request: the browser drops expired cookies, everything else rides along. */
function navigate() {
  for (const [n, exp] of expiries) if (exp <= Date.now()) { H.jar.delete(n); expiries.delete(n); }
}
const jsonReq = (body) => new Request("https://admin.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function call(handler, body) {
  navigate();
  const res = await handler(body === undefined ? undefined : jsonReq(body));
  applyCookies(res);
  return { status: res.status, json: await res.json().catch(() => ({})), res };
}
const code = () => core.totpAt(SECRET, Date.now());
async function unlock(extra = {}) {
  const r = await call(unlockRoute.POST, { action: "test", code: code(), ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.verified, true);
  return r;
}
/** The server check every gated route runs (stepUpGate), as a fresh request. */
async function gated(key) {
  navigate();
  const res = await stepUpGate("alvin", key, null);
  return res ? { status: res.status, json: await res.json() } : { status: 200 };
}
const audits = (a) => H.db.ops_audit_log.filter((r) => r.action === a);

describe("one Unlock covers several gated actions across pages and areas", () => {
  it("numbers, billing, businesses, voices and Settings › Security all go through on one Unlock, no second code", async () => {
    await unlock();
    const steps = [
      [0, "did-pool:assign_specific"], // Numbers page
      [1 * MIN, "invoice:void"], // Invoices page (billing, always-on)
      [2 * MIN, "billing:grant_minutes"], // Billing page
      [4 * MIN, "businesses:transfer_owner"], // Business pane
      [6 * MIN, "voices:delete"], // Voices page
      [8 * MIN, "package-versions:publish"], // Packages page
      [9 * MIN + 59_000, "did-pool:release"], // back to Numbers, last second
    ];
    for (const [off, key] of steps) {
      at(T0 + off);
      assert.equal((await gated(key)).status, 200, `${key} at +${off / 1000}s`);
    }
    at(T0 + 3 * MIN);
    const area = await call(areasRoute.POST, { area: "voices", required: false, reason: "test window" });
    assert.equal(area.status, 200, "Settings › Security area switch on the same Unlock");
    assert.equal(audits("admin.step_up.verified").length, 1, "one code entered");
    assert.equal(audits("admin.step_up.blocked").length, 0, "never asked again");
  });
});

describe("moving between pages and reloading keeps the Unlock", () => {
  it("cookie is site-wide for the window; every reload reads the same server expiry", async () => {
    const r = await unlock();
    const c = r.res.cookies.get(core.UNLOCK_COOKIE);
    assert.equal(c.path, "/", "sent on every Admin page");
    assert.equal(c.httpOnly, true);
    assert.equal(c.maxAge, 600, "cookie lives exactly the 10-minute window");
    const until = r.json.unlockedUntil;
    for (const off of [30_000, 2 * MIN, 5 * MIN, 9 * MIN]) {
      at(T0 + off);
      const g = await call(unlockRoute.GET); // page load / reload status read
      assert.equal(g.json.unlockedUntil, until, `reload at +${off / 1000}s`);
      assert.equal((await gated("businesses:archive")).status, 200);
    }
  });
});

describe("expiry", () => {
  it("at the end of the window the next gated action asks for Unlock again; a new Unlock works", async () => {
    const first = await unlock();
    const grantId = first.res.cookies.get(core.UNLOCK_COOKIE).value;
    at(T0 + 10 * MIN - 1);
    assert.equal((await gated("invoice:credit_note")).status, 200, "1 ms before the end");
    at(T0 + 10 * MIN);
    const g = await gated("invoice:credit_note");
    assert.equal(g.status, 403);
    assert.equal(g.json.error, "step_up_required");
    assert.equal(g.json.action, "invoice:credit_note", "the UI opens the sheet for this action");
    assert.equal((await call(unlockRoute.GET)).json.unlockedUntil, null);
    assert.equal(audits("admin.step_up.blocked").length, 1);
    // The server refuses on its own, even if a client keeps sending the expired cookie.
    H.jar.set(core.UNLOCK_COOKIE, grantId);
    assert.equal((await stepUpGate("alvin", "invoice:credit_note", null))?.status, 403, "server-side expiry");
    later(30_000);
    await unlock();
    assert.equal((await gated("invoice:credit_note")).status, 200);
  });
});

describe("End now", () => {
  it("ends the Unlock immediately, even if the old cookie id is replayed", async () => {
    const r = await unlock();
    const grantId = r.res.cookies.get(core.UNLOCK_COOKIE).value;
    later(MIN);
    const e = await call(sessionRoute.POST, { op: "end_unlock" });
    assert.equal(e.status, 200);
    assert.equal(H.jar.has(core.UNLOCK_COOKIE), false, "cookie cleared");
    assert.equal((await gated("did-pool:release")).status, 403);
    H.jar.set(core.UNLOCK_COOKIE, grantId);
    assert.equal((await gated("did-pool:release")).status, 403, "revoked server-side");
    assert.equal(audits("admin.step_up.ended").length, 1);
  });
});

describe("Unlock lasts setting", () => {
  it("changing it needs a live Unlock and a reason, is always-locked, audited, and applies to the next Unlock only", async () => {
    assert.ok(core.ALWAYS_UNLOCK["step-up:set_duration"], "always-locked");
    // Even with the Operators area switched off, the duration change still needs Unlock.
    H.db.admin_step_up_area.push({ area: "operators", required: false });
    assert.equal(core.requiresUnlock("step-up:set_duration", { operators: false }), true);
    const blocked = await call(durationRoute.POST, { minutes: 30, reason: "longer shifts" });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.action, "step-up:set_duration");

    const first = await unlock();
    assert.equal(Date.parse(first.json.unlockedUntil), T0 + 10 * MIN, "default 10");
    assert.equal((await call(durationRoute.POST, { minutes: 30 })).status, 400, "reason required");
    later(MIN);
    const ok = await call(durationRoute.POST, { minutes: 30, reason: "longer shifts" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.minutes, 30);
    const row = audits("admin.step_up.duration_changed")[0];
    assert.ok(row, "audited");
    assert.deepEqual({ from: row.detail.from, to: row.detail.to, reason: row.detail.reason }, { from: 10, to: 30, reason: "longer shifts" });

    // The live Unlock keeps its 10-minute end.
    assert.equal((await call(unlockRoute.GET)).json.unlockedUntil, first.json.unlockedUntil);
    at(T0 + 10 * MIN);
    assert.equal((await gated("voices:delete")).status, 403, "current Unlock not stretched");

    // Next Unlock lasts 30.
    later(30_000);
    const t1 = clock;
    const next = await unlock();
    assert.equal(Date.parse(next.json.unlockedUntil), t1 + 30 * MIN);
    assert.equal(next.res.cookies.get(core.UNLOCK_COOKIE).maxAge, 30 * 60);
    at(t1 + 29 * MIN);
    assert.equal((await gated("voices:delete")).status, 200, "inside 30");
    at(t1 + 30 * MIN);
    assert.equal((await gated("voices:delete")).status, 403, "ends at 30");
  });

  it("the server clamps to 5–30 and rejects junk", async () => {
    await unlock();
    assert.equal((await call(durationRoute.POST, { minutes: 999, reason: "too long" })).json.minutes, 30);
    assert.equal(H.db.admin_step_up_setting[0].unlock_minutes, 30);
    assert.equal((await call(durationRoute.POST, { minutes: 1, reason: "too short" })).json.minutes, 5);
    assert.equal(H.db.admin_step_up_setting[0].unlock_minutes, 5);
    assert.equal((await call(durationRoute.POST, { minutes: "abc", reason: "junk" })).status, 400);
    assert.equal((await call(durationRoute.POST, { reason: "missing" })).status, 400);
    // A bad stored value (e.g. hand-edited) is clamped when read: 2 → 5-minute Unlock.
    H.db.admin_step_up_setting[0].unlock_minutes = 2;
    later(30_000);
    const t = clock;
    const r = await unlock();
    assert.equal(Date.parse(r.json.unlockedUntil), t + 5 * MIN);
    // Missing row → 10.
    H.db.admin_step_up_setting = [];
    later(30_000);
    assert.equal(Date.parse((await unlock()).json.unlockedUntil), clock + 10 * MIN);
    assert.deepEqual(time.UNLOCK_MINUTES_CHOICES, [5, 10, 15, 30]);
    for (const [i, o] of [[5, 5], [10, 10], [15, 15], [30, 30], [0, 5], [-3, 5], [31, 30], [12.4, 12], [null, 10], ["", 10], [true, 10], [Infinity, 10]]) {
      assert.equal(time.clampUnlockMinutes(i), o, String(i));
    }
  });
});

describe("sign-out", () => {
  it("clears the Unlock cookie and revokes the grant, so a replayed id is dead", async () => {
    const r = await unlock();
    const grantId = r.res.cookies.get(core.UNLOCK_COOKIE).value;
    later(MIN);
    const jar = new Map(H.jar);
    const res = await logoutRoute.POST(new NextRequest("https://admin.test/api/logout", { method: "POST", cookieJar: jar }));
    assert.equal(res.status, 303);
    applyCookies(res);
    assert.equal(H.jar.has(core.UNLOCK_COOKIE), false);
    assert.ok(H.db.admin_step_up_grant.find((g) => g.id === grantId).revoked_at, "grant row revoked");
    H.jar.set(core.UNLOCK_COOKIE, grantId);
    assert.equal((await gated("invoice:void")).status, 403);
  });
});

describe("lockout", () => {
  it("5 wrong codes lock Unlock for 15 minutes, even the right code; after 15 minutes it works", async () => {
    const wrong = () => String((Number(code()) + 1) % 1_000_000).padStart(6, "0");
    for (let i = 1; i <= 4; i += 1) {
      const r = await call(unlockRoute.POST, { code: wrong() });
      assert.equal(r.status, 403, `wrong ${i}`);
      assert.equal(r.json.error, "step_up_wrong_code");
    }
    const fifth = await call(unlockRoute.POST, { code: wrong() });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.json.error, "step_up_locked");
    assert.equal(Date.parse(fifth.json.lockedUntil), T0 + 15 * MIN);
    later(MIN);
    const right = await call(unlockRoute.POST, { code: code() });
    assert.equal(right.status, 429, "right code refused while locked");
    assert.equal(H.jar.has(core.UNLOCK_COOKIE), false);
    assert.equal((await gated("did-pool:release")).status, 403);
    at(T0 + 15 * MIN);
    await unlock();
    assert.equal((await gated("did-pool:release")).status, 200);
    assert.equal(audits("admin.step_up.locked").length, 1);
    assert.equal(audits("admin.step_up.failed").length, 5);
  });
});

describe("time-left display matches the server expiry", () => {
  it("countdown is computed from the server's unlockedUntil and hits 0:00 exactly when the gate closes", async () => {
    const r = await unlock();
    const until = r.json.unlockedUntil;
    const grantRow = H.db.admin_step_up_grant[0];
    assert.equal(until, grantRow.expires_at, "POST answer = stored grant");
    assert.equal((await call(unlockRoute.GET)).json.unlockedUntil, until, "page load = stored grant");
    assert.equal(time.unlockTimeLeft(until, Date.now()).text, "10:00");
    at(T0 + 4 * MIN + 30_000);
    assert.equal(time.unlockTimeLeft(until, Date.now()).text, "5:30");
    at(T0 + 10 * MIN - 1);
    assert.ok(time.unlockTimeLeft(until, Date.now()).left > 0);
    assert.equal((await gated("invoice:void")).status, 200, "display still shows time → gate open");
    at(T0 + 10 * MIN);
    assert.deepEqual(time.unlockTimeLeft(until, Date.now()), { left: 0, text: "0:00" });
    assert.equal((await gated("invoice:void")).status, 403, "display 0:00 → gate closed");
    assert.deepEqual(time.unlockTimeLeft(null, Date.now()), { left: 0, text: "0:00" });
  });
});
