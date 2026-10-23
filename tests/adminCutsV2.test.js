const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = (p) => fs.readFileSync(path.join(root, "dashboard/src", p), "utf8");
const page = (p) => src(`app/admin/(console)/${p}/page.tsx`);
const load = () => import(path.join(root, "dashboard/src/lib/adminLinks.ts"));
const CUT = /\b(Ledger|KES Credit|Quarantine|Plans|Today|Activity|Platform)\b/;

test("v2 nav and tabs use the new names only", async () => {
  const { ADMIN_LINKS_V2, ADMIN_BILLING_TABS, ADMIN_SETTINGS_TABS } = await load();
  const labels = [...ADMIN_LINKS_V2, ...ADMIN_BILLING_TABS, ...ADMIN_SETTINGS_TABS].map((l) => l.label);
  for (const l of labels) assert.doesNotMatch(l, CUT, l);
  for (const want of ["Overview", "Packages", "Audit log", "Services", "Settings"]) assert.ok(labels.includes(want), want);
  assert.ok(!labels.some((l) => /wallet|credit|catalog/i.test(l)));
});

test("Ledger and the catalog alias redirect to their v2 homes; old shell unchanged", async () => {
  const { adminV2Redirect, ADMIN_LINKS } = await load();
  assert.equal(adminV2Redirect("/admin/wallets"), "/admin/billing/home");
  assert.equal(adminV2Redirect("/admin/billing/catalog"), "/admin/billing/packages");
  assert.match(page("wallets"), /ADMIN_V2 === "on"\) redirect\("\/admin\/billing\/home"\);\n\s+redirect\("\/admin\/businesses"\)/);
  assert.match(page("billing/catalog"), /ADMIN_V2 === "on"\) redirect\("\/admin\/billing\/packages"\);\n\s+redirect\("\/admin\/packages"\)/);
  assert.deepEqual(ADMIN_LINKS.map((l) => l.label), ["Today", "Businesses", "Quality", "Billing", "Numbers", "Platform", "Activity", "Voices"]);
});

test("v2 screens show no cut names and no ledger, credit or duplicate number actions", () => {
  const dir = path.join(root, "dashboard/src/components/admin/v2");
  for (const f of fs.readdirSync(dir)) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    const visible = [...s.matchAll(/(?:label|title|hint):\s*"([^"]+)"|>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)].map((m) => m[1] || m[2]);
    for (const t of visible) assert.doesNotMatch(t, CUT, `${f}: ${t}`);
    assert.doesNotMatch(s, /\/admin\/(wallets|packages|activity|platform|billing\/catalog)\b/, f);
    assert.doesNotMatch(s, /Add number|Buy number|Release number|Assign number/, f);
  }
});
