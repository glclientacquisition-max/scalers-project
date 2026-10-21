// Desk Settings Phase 1.1: /settings/[section] routes, 308s from old ?tab=&panel= links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const nav = await import("../dashboard/src/lib/businessSettingsNav.ts");
const chat = await import("../dashboard/src/lib/deskTicketChat.ts");

const read = (rel: string) => readFileSync(rel, "utf8");

test("every Settings destination has one /settings/[section] path that round-trips", () => {
  const seen = new Set<string>();
  for (const item of nav.settingsNavItems()) {
    const href = nav.settingsNavHref(item.target);
    assert.doesNotMatch(href, /\?/, `${item.label} has a query URL`);
    if ("href" in item.target) continue;
    const m = /^\/settings\/([a-z-]+)$/.exec(href);
    assert.ok(m, `${item.label}: ${href}`);
    assert.ok(!seen.has(m[1]), `duplicate slug ${m[1]}`);
    seen.add(m[1]);
    const view = nav.parseSettingsSection(m[1]);
    assert.ok(view, `${m[1]} does not parse`);
    assert.equal(view.tab, item.target.tab);
    if (item.target.tab === "train") assert.equal(view.trainPanel, item.target.panel);
  }
  assert.deepEqual([...seen].sort(), [...nav.SETTINGS_SECTIONS].sort());
  assert.equal(nav.parseSettingsSection("nope"), null);
  assert.equal(nav.parseSettingsSection("constructor"), null);
  assert.equal(nav.parseSettingsSection("plan"), null);
  assert.equal(nav.businessSettingsHref("menu"), "/settings");
  assert.equal(nav.businessSettingsHref("train"), "/settings/identity");
  assert.equal(nav.businessSettingsHref("train", "tools"), "/settings/voice");
  assert.equal(nav.businessSettingsHref("alerts"), "/settings/notify");
});

test("old ?tab=&panel= links map to the same section", () => {
  const cases: Array<[string, string | null]> = [
    ["", null],
    ["members=20", null],
    ["tab=train&panel=hours", "/settings/hours"],
    ["?tab=train&panel=tools", "/settings/voice"],
    ["tab=train", "/settings/identity"],
    ["tab=hours", "/settings/hours"],
    ["tab=identity&panel=faqs", "/settings/faqs"],
    ["tab=catalog", "/settings/catalogue"],
    ["tab=train&panel=catalog", "/settings/catalogue"],
    ["panel=catalog", "/settings/catalogue"],
    ["tab=catalog&filter=unpriced", "/settings/catalogue?filter=unpriced"],
    ["tab=import", "/settings/import"],
    ["tab=test", "/settings/test"],
    ["tab=calls", "/settings/calls"],
    ["tab=alerts", "/settings/notify"],
    ["tab=assistant-say", "/settings/assistant-say"],
    ["tab=train&panel=team&members=40&invites=20", "/settings/team?members=40&invites=20"],
    ["tab=appearance", "/settings"],
    ["tab=updates", "/settings"],
    ["tab=menu", "/settings"],
    ["tab=bogus&panel=bogus", "/settings"],
  ];
  for (const [search, want] of cases) {
    assert.equal(nav.legacySettingsRedirect(search), want, search);
    assert.equal(nav.legacySettingsRedirect(new URLSearchParams(search)), want, `params ${search}`);
  }
  // Old URL and new URL open the same tab and panel.
  for (const tab of ["train", "catalog", "import", "test", "calls", "alerts", "assistant-say"] as const) {
    for (const panel of ["identity", "hours", "locations", "policies", "team", "faqs", "tools", "pronunciation"] as const) {
      const search = `tab=${tab}&panel=${panel}`;
      const to = nav.legacySettingsRedirect(search)!;
      const view = nav.parseSettingsSection(to.replace("/settings/", ""));
      assert.ok(view, search);
      assert.equal(view.tab, nav.parseBusinessSettingsTab(tab, panel), search);
      if (view.tab === "train") assert.equal(view.trainPanel, nav.parseBusinessSettingsPanel(panel, tab), search);
    }
  }
});

test("proxy sends old links a 308 before the page runs", () => {
  const proxy = read("dashboard/src/proxy.ts");
  assert.match(proxy, /legacySettingsRedirect\(request\.nextUrl\.searchParams\)/);
  assert.match(proxy, /if \(path === "\/settings"\) \{[\s\S]{0,200}?308\)/);
});

test("section route renders the same Settings body as the home", () => {
  const dir = "dashboard/src/app/(desk)/settings";
  const section = read(`${dir}/[section]/page.tsx`);
  const home = read(`${dir}/page.tsx`);
  const body = read(`${dir}/SettingsBody.tsx`);
  assert.match(section, /<DeskPageGate>/);
  assert.match(section, /parseSettingsSection\(section\)/);
  assert.match(section, /if \(!view\) redirect\("\/settings"\)/);
  assert.match(section, /<SettingsBody tab=\{view\.tab\} trainPanel=\{view\.trainPanel\}/);
  assert.match(home, /<SettingsBody tab="menu"/);
  assert.match(body, /<BusinessSettingsShell/);
  assert.match(body, /tenantForSettingsView\(tenant, tab, trainPanel\)/);
  // Plan and Billing stay static routes and win over [section].
  assert.ok(existsSync(`${dir}/plan/page.tsx`));
  assert.ok(existsSync(`${dir}/billing/page.tsx`));
});

test("nested sections match the old nested tabs (phone tabs hide on a section)", () => {
  const oldNested = new Set(["catalog", "train", "import", "test", "alerts"]);
  for (const slug of nav.SETTINGS_SECTIONS) {
    const view = nav.parseSettingsSection(slug)!;
    assert.equal(chat.SETTINGS_NESTED_SECTIONS.has(slug), oldNested.has(view.tab), slug);
    const oldHref = `tab=${view.tab}${view.tab === "train" ? `&panel=${view.trainPanel}` : ""}`;
    assert.equal(chat.isDeskNestedPath(`/settings/${slug}`), chat.isDeskNestedPath("/settings", oldHref), slug);
  }
  assert.equal(chat.isDeskNestedPath("/settings"), false);
  assert.equal(chat.isDeskNestedPath("/settings/hours/"), true);
  assert.equal(chat.isDeskNestedPath("/settings/plan"), true);
});

test("no live link still builds a ?tab= Settings URL", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (full.includes(`${path.sep}dev`)) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(name) && /\/settings\?(tab|panel)=|tab: "train", panel:/.test(readFileSync(full, "utf8"))) {
        offenders.push(full);
      }
    }
  };
  walk("dashboard/src/app");
  walk("dashboard/src/components");
  assert.deepEqual(offenders, []);
  assert.match(read("dashboard/src/components/MembersPanel.tsx"), /`\/settings\/team\?\$\{params\.toString\(\)\}`/);
  assert.match(read("dashboard/src/components/structured/StructuredSettingsSlots.tsx"), /businessSettingsHref\("catalog"\)\}\?filter=unpriced/);
});
