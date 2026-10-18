/**
 * Call setup per account (follow-up to #755): one-time browser to account copy,
 * automatic "tested" from the first call after setup opened, the 7-day quiet nudge,
 * which Overview card shows, and the owner-only write path in SQL.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./tsResolveHook.mjs", pathToFileURL("./tests/"));
const store = await import("../dashboard/src/lib/callSetupStore.ts");
const status = await import("../dashboard/src/lib/callSetupStatus.ts");

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-10-18T09:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString();
const setup = (patch: Record<string, unknown> = {}) => store.parseCallSetup({ ...patch });
const resolve = (s: unknown, activity: { firstCallAfterOpenAt: string | null; lastCallAt: string | null } | null, now: number, numberReady = true) =>
  status.resolveCallSetupStatus({ numberReady, setup: s as never, activity, now });

describe("browser to account copy (one time)", () => {
  const local = store.parseCallSetup({ option: "forward", network: "airtel", choices: ["no_answer"], ring_seconds: 30, tested_at: iso(T0) });

  it("copies the browser picks up when the account has nothing", () => {
    const copy = store.migrateLocalToDb(null, local, iso(T0 + DAY));
    assert.ok(copy);
    assert.equal(copy.option, "forward");
    assert.equal(copy.network, "airtel");
    assert.deepEqual(copy.choices, ["no_answer"]);
    assert.equal(copy.ring_seconds, 30);
    // v1 only had the button, so an old test counts as manual.
    assert.equal(copy.tested_via, "manual");
    // Opened "now": calls before the copy never count as an automatic test.
    assert.equal(copy.opened_at, iso(T0 + DAY));
  });

  it("never overwrites the account copy", () => {
    const db = store.parseCallSetup({ option: "main_number" });
    assert.equal(store.migrateLocalToDb(db, local, iso(T0)), null);
  });

  it("skips an empty browser value", () => {
    assert.equal(store.migrateLocalToDb(null, store.emptyCallSetup(), iso(T0)), null);
    assert.equal(store.migrateLocalToDb(null, null, iso(T0)), null);
  });

  it("keeps an opened time the browser already had", () => {
    const withOpen = store.parseCallSetup({ option: "forward", opened_at: iso(T0 - DAY) });
    assert.equal(store.migrateLocalToDb(null, withOpen, iso(T0))?.opened_at, iso(T0 - DAY));
  });

  it("normalises times so the database check accepts them", () => {
    const s = store.parseCallSetup({ tested_at: "2026-10-18 12:00:00+03:00", opened_at: "nonsense" });
    assert.equal(s.tested_at, "2026-10-18T09:00:00.000Z");
    assert.equal(s.opened_at, null);
  });
});

describe("merging saves", () => {
  it("stamps opened_at once and keeps the first one", () => {
    const first = store.mergeCallSetup(null, {}, { nowIso: iso(T0), opened: true });
    assert.equal(first.opened_at, iso(T0));
    const again = store.mergeCallSetup(first, { network: "safaricom" }, { nowIso: iso(T0 + DAY), opened: true });
    assert.equal(again.opened_at, iso(T0));
    assert.equal(again.network, "safaricom");
  });

  it("Test again clears how it was tested", () => {
    const tested = store.mergeCallSetup(null, { tested_at: iso(T0), tested_via: "manual" }, { nowIso: iso(T0) });
    assert.equal(tested.tested_via, "manual");
    const cleared = store.mergeCallSetup(tested, { tested_at: null }, { nowIso: iso(T0) });
    assert.equal(cleared.tested_at, null);
    assert.equal(cleared.tested_via, null);
  });
});

describe("automatic tested from the first call", () => {
  const opened = setup({ option: "forward", opened_at: iso(T0) });

  it("first call after opening counts as tested (auto)", () => {
    const s = resolve(opened, { firstCallAfterOpenAt: iso(T0 + 3600e3), lastCallAt: iso(T0 + 3600e3) }, T0 + 2 * 3600e3);
    assert.equal(s.tested, true);
    assert.equal(s.testedVia, "auto");
    assert.equal(s.testedAt, iso(T0 + 3600e3));
    assert.equal(s.showFinish, false);
    assert.equal(s.showAutoDone, true);
    assert.equal(status.callSetupCardMode(s), "auto");
  });

  it("calls before opening do not count", () => {
    const s = resolve(opened, { firstCallAfterOpenAt: iso(T0 - 1000), lastCallAt: iso(T0 - 1000) }, T0 + DAY);
    assert.equal(s.tested, false);
    assert.equal(s.showFinish, true);
    assert.equal(status.callSetupCardMode(s), "finish");
  });

  it("no opened time means no auto test", () => {
    const s = resolve(setup({ option: "forward" }), { firstCallAfterOpenAt: iso(T0), lastCallAt: iso(T0) }, T0 + DAY);
    assert.equal(s.tested, false);
  });

  it("the button wins over auto and keeps its time", () => {
    const manual = setup({ opened_at: iso(T0), tested_at: iso(T0 + 600e3), tested_via: "manual" });
    const s = resolve(manual, { firstCallAfterOpenAt: iso(T0 + 60e3), lastCallAt: iso(T0 + 60e3) }, T0 + DAY);
    assert.equal(s.testedVia, "manual");
    assert.equal(s.testedAt, iso(T0 + 600e3));
    assert.equal(s.showAutoDone, false);
  });

  it("the working note hides once seen, or after 14 days", () => {
    const act = { firstCallAfterOpenAt: iso(T0 + 1000), lastCallAt: iso(T0 + 13 * DAY) };
    const seen = setup({ opened_at: iso(T0), auto_seen_at: iso(T0 + DAY) });
    assert.equal(resolve(seen, act, T0 + 2 * DAY).showAutoDone, false);
    assert.equal(resolve(opened, act, T0 + 13 * DAY).showAutoDone, true);
    assert.equal(resolve(opened, act, T0 + 15 * DAY).showAutoDone, false);
  });

  it("nothing shows while the number is pending", () => {
    const s = resolve(opened, { firstCallAfterOpenAt: iso(T0 + 1000), lastCallAt: iso(T0 + 1000) }, T0 + 30 * DAY, false);
    assert.equal(status.callSetupCardMode(s), null);
  });

  it("status line says how it was tested", () => {
    assert.equal(status.testedLine({ tested: false, testedVia: null, testedAt: null }), "Not tested yet");
    assert.match(status.testedLine({ tested: true, testedVia: "auto", testedAt: iso(T0) }), /^Working since 18 Oct$/);
    assert.match(status.testedLine({ tested: true, testedVia: "manual", testedAt: iso(T0) }), /^Tested by you 18 Oct$/);
  });
});

describe("7-day quiet nudge", () => {
  const manual = (extra: Record<string, unknown> = {}) => setup({ opened_at: iso(T0), tested_at: iso(T0), tested_via: "manual", ...extra });

  it("shows 7 days after the last call, not before", () => {
    const act = { firstCallAfterOpenAt: null, lastCallAt: iso(T0 + DAY) };
    assert.equal(resolve(manual(), act, T0 + DAY + 7 * DAY - 1000).showNudge, false);
    const s = resolve(manual(), act, T0 + DAY + 7 * DAY);
    assert.equal(s.showNudge, true);
    assert.equal(s.quietSince, iso(T0 + DAY));
    assert.equal(status.callSetupCardMode(s), "nudge");
  });

  it("counts from the test when no call has come yet", () => {
    assert.equal(resolve(manual(), null, T0 + 6 * DAY).showNudge, false);
    assert.equal(resolve(manual(), null, T0 + 7 * DAY).showNudge, true);
  });

  it("dismissing hides it until the next call starts a new quiet spell", () => {
    const act = { firstCallAfterOpenAt: null, lastCallAt: iso(T0 + DAY) };
    const dismissed = manual({ nudge_dismissed_at: iso(T0 + 9 * DAY) });
    assert.equal(resolve(dismissed, act, T0 + 20 * DAY).showNudge, false);
    const newer = { firstCallAfterOpenAt: null, lastCallAt: iso(T0 + 10 * DAY) };
    assert.equal(resolve(dismissed, newer, T0 + 16 * DAY).showNudge, false);
    assert.equal(resolve(dismissed, newer, T0 + 17 * DAY).showNudge, true);
  });

  it("never shows before setup is done, and the working note comes first", () => {
    assert.equal(resolve(setup({ opened_at: iso(T0) }), null, T0 + 30 * DAY).showNudge, false);
    const auto = setup({ opened_at: iso(T0) });
    const act = { firstCallAfterOpenAt: iso(T0 + 1000), lastCallAt: iso(T0 + 1000) };
    const s = resolve(auto, act, T0 + 8 * DAY);
    assert.equal(s.showAutoDone, true);
    assert.equal(s.showNudge, false);
    const seen = setup({ opened_at: iso(T0), auto_seen_at: iso(T0 + DAY) });
    assert.equal(resolve(seen, act, T0 + 8 * DAY).showNudge, true);
  });

  it("uses the 7 and 14 day constants", () => {
    assert.equal(status.NUDGE_QUIET_DAYS, 7);
    assert.equal(status.AUTO_DONE_SHOW_DAYS, 14);
  });
});

describe("wiring and write path", () => {
  it("SQL: owner/admin only write through the function, values checked, additive", () => {
    const sql = readFileSync("supabase/migrations/20261018130000_tenant_call_setup.sql", "utf8");
    assert.match(sql, /add column if not exists call_setup jsonb/);
    assert.match(sql, /security definer set search_path = public/);
    assert.match(sql, /auth\.uid\(\) is null or not public\.member_can_admin\(p_tenant\)/);
    assert.match(sql, /revoke all on function public\.save_call_setup\(uuid, jsonb\) from public, anon;/);
    assert.match(sql, /grant execute on function public\.save_call_setup\(uuid, jsonb\) to authenticated;/);
    assert.match(sql, /check \(public\.call_setup_valid\(call_setup\)\)/);
    assert.doesNotMatch(sql, /grant (select, )?update[^;]*call_setup/i);
    assert.doesNotMatch(sql, /^\s*(delete|truncate|drop table)/im);
  });

  it("server action checks settings permission and the business", () => {
    const action = readFileSync("dashboard/src/app/onboarding/line/callSetupActions.ts", "utf8");
    assert.match(action, /^"use server";/);
    assert.match(action, /memberDenied\("settings\.edit"\)/);
    assert.match(action, /rpc\("save_call_setup"/);
  });

  it("Settings has Calls & forwarding under Assistant", () => {
    const nav = readFileSync("dashboard/src/lib/businessSettingsNav.ts", "utf8");
    assert.match(nav, /label: "Calls & forwarding"[\s\S]{0,160}?target: \{ tab: "calls" \}/);
    const panel = readFileSync("dashboard/src/components/CallsForwardingPanel.tsx", "utf8");
    assert.match(panel, /ALL_OFF_CODE/);
    assert.match(panel, /href="\/onboarding\/line"/);
    assert.match(panel, /Change setup/);
  });

  it("Overview card: nudge links to Settings and saves dismissal on the account", () => {
    const card = readFileSync("dashboard/src/components/HomeCallSetupCard.tsx", "utf8");
    assert.match(card, /CALLS_SETTINGS_HREF = "\/settings\?tab=calls"/);
    assert.match(card, /Check your call setup/);
    assert.match(card, /nudge_dismissed_at/);
    assert.match(card, /auto_seen_at/);
    const home = readFileSync("dashboard/src/app/(desk)/home/page.tsx", "utf8");
    assert.match(home, /<RoleGate action="settings\.edit" mode="hide">[\s\S]{0,200}?<HomeCallSetupCard/);
  });

  it("screen copy: no live transfer promise, no vendor names, no dashes, kit only", () => {
    for (const f of [
      "dashboard/src/components/HomeCallSetupCard.tsx",
      "dashboard/src/components/CallsForwardingPanel.tsx",
      "dashboard/src/lib/callSetupStatus.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      const strings = (src.match(/"[^"\n]{12,}"|`[^`\n]{12,}`|>[^<>{}\n]{12,}</g) || []).join("\n");
      assert.doesNotMatch(strings, /put (you|them) through now|transfer(red)? (you|the call)|connect(s|ed)? you live/i, f);
      assert.doesNotMatch(strings, /sautikit|supabase|vercel|railway|twilio|africa'?s talking/i, f);
      assert.doesNotMatch(strings, /[\u2013\u2014]/, f);
      assert.doesNotMatch(src, /framer|motion\/react|gsap|lottie/i, f);
      assert.doesNotMatch(src, /DeskDialog|role="dialog"/, f);
    }
  });
});
