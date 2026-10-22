const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/adminLinks.ts"));
const page = (p) => read(`dashboard/src/app/admin/(console)/${p}/page.tsx`);

test("v2 nav is the six locked entries; phone has four tabs plus More", async () => {
  const { ADMIN_LINKS_V2, adminPhoneTabs, adminPhoneMore, ADMIN_LINKS } = await load();
  assert.deepEqual(ADMIN_LINKS_V2.map((l) => l.label), ["Overview", "Businesses", "Billing", "Numbers", "Quality", "Settings"]);
  assert.deepEqual(adminPhoneTabs(true).map((l) => l.label), ["Overview", "Businesses", "Billing", "Numbers"]);
  assert.deepEqual(adminPhoneMore(true).map((l) => l.label), ["Quality", "Settings"]);
  assert.equal(ADMIN_LINKS.length, 8, "old shell nav unchanged");
  assert.deepEqual(adminPhoneTabs().map((l) => l.label), ["Today", "Businesses", "Quality", "Billing"]);
});

test("redirect map sends old routes to their one home", async () => {
  const { adminV2Redirect } = await load();
  const cases = {
    "/admin/billing": "/admin/billing/invoices",
    "/admin/packages": "/admin/billing/packages",
    "/admin/billing/catalog": "/admin/billing/packages",
    "/admin/platform": "/admin/settings/services",
    "/admin/voices": "/admin/settings/voices",
    "/admin/activity": "/admin/settings/audit",
    "/admin/businesses/b1": "/admin/businesses?pane=b1",
    "/admin/billing/t1": "/admin/businesses?pane=t1&section=money",
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(adminV2Redirect(from), to, from);
  for (const stay of ["/admin", "/admin/billing/invoices", "/admin/billing/payments", "/admin/businesses/b1/usage", "/admin/quality/call/c1", "/admin/numbers"]) {
    assert.equal(adminV2Redirect(stay), null, stay);
  }
});

test("pages apply the map only under ADMIN_V2 and stay as-is otherwise", () => {
  for (const [p, to] of [["billing", "/admin/billing/invoices"], ["packages", "/admin/billing/packages"], ["platform", "/admin/settings/services"], ["voices", "/admin/settings/voices"], ["activity", "/admin/settings/audit"]]) {
    const s = page(p);
    assert.match(s, /process\.env\.ADMIN_V2 === "on"\) redirect\(/, p);
    assert.ok(s.includes(to), `${p} → ${to}`);
  }
  assert.match(page("businesses/[id]"), /ADMIN_V2 === "on"\) redirect\(`\/admin\/businesses\?pane=/);
  assert.match(page("billing/[tenantId]"), /ADMIN_V2 === "on"\) redirect\(`\/admin\/businesses\?pane=.*section=money/);
  for (const p of ["billing/packages", "settings/services", "settings/voices", "settings/audit", "settings"]) {
    assert.match(page(p), /ADMIN_V2 !== "on"\) notFound\(\)/, `${p} is v2-only`);
  }
});

test("v2 parent: tabs and list homes carry no shell back; nested pages go to their entry", async () => {
  const { adminParentTarget } = await load();
  assert.equal(adminParentTarget("/admin/billing/payments", true), null);
  assert.equal(adminParentTarget("/admin/settings/voices", true), null);
  assert.deepEqual(adminParentTarget("/admin/billing/invoices/i1", true), { href: "/admin/billing/invoices", label: "Invoices" });
  assert.deepEqual(adminParentTarget("/admin/quality/call/c1", true), { href: "/admin/quality", label: "Quality" });
});

test("renamed titles and no supplier names in the new chrome", () => {
  const s = read("dashboard/src/app/admin/(console)/_screens/PackagesScreen.tsx");
  assert.ok(s.includes('"Packages" : "Plans"'));
  assert.ok(read("dashboard/src/app/admin/(console)/_screens/ServicesScreen.tsx").includes('"Services" : "Platform"'));
  const chrome = read("dashboard/src/lib/adminLinks.ts") + read("dashboard/src/components/admin/v2/AdminSectionTabs.tsx");
  assert.doesNotMatch(chrome.split("ADMIN_LINKS_V2")[1] || "", /sautikit|soniox|elevenlabs|africa'?s talking|paystack|mpesa daraja/i);
});
