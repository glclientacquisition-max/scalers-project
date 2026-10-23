const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("live summary helper has no Environment list or Hosting switch jargon", () => {
  const src = read("dashboard/src/lib/adminPayCopy.ts");
  assert.match(src, /export function liveBusinessesSummary/);
  assert.match(src, /Live payments are off/);
  assert.doesNotMatch(src.slice(src.indexOf("liveBusinessesSummary")), /Environment list/);
  const readSrc = read("dashboard/src/lib/adminPayRead.ts");
  assert.match(readSrc, /liveBusinessesSummary\(/);
  assert.doesNotMatch(readSrc, /Environment list/);
});

test("Payments v2: no ReasonedSwitch; Unlock CTA; ADMIN_V2 branch on page", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminPaymentsV2.tsx");
  const page = read("dashboard/src/app/admin/(console)/billing/payments/page.tsx");
  const dev = read("dashboard/src/app/dev/admin-payments/page.tsx");
  assert.doesNotMatch(ui, /ReasonedSwitch/);
  assert.match(ui, /UnlockCta/);
  assert.match(read("dashboard/src/components/ops/UnlockCta.tsx"), /Unlock to edit/);
  assert.match(ui, /UnlockCta|StepUpSheet/);
  assert.match(ui, /site="payments"/);
  assert.doesNotMatch(ui, /Collections stay|Desk ships|Environment list/i);
  assert.match(page, /ADMIN_V2 === "on"[\s\S]*AdminPaymentsV2/);
  assert.match(dev, /AdminShell[^>]*v2/);
  assert.match(dev, /ADMIN_BILLING_TABS/);
});

test("ops loaders replace SkeletonList on listed routes", () => {
  const routes = [
    "businesses", "numbers", "quality", "packages", "billing/invoices", "billing/payments", "billing/home",
    "settings/general", "settings/services", "settings/voices", "settings/audit",
  ];
  for (const r of routes) {
    const s = read(`dashboard/src/app/admin/(console)/${r}/loading.tsx`);
    assert.doesNotMatch(s, /SkeletonList/, r);
    assert.match(s, /OpsLoading/, r);
  }
  assert.doesNotMatch(read("dashboard/src/app/admin/(console)/loading.tsx"), /SkeletonList/);
});

test("split list fills width when pane closed; soft min below 1280", () => {
  const css = read("dashboard/src/styles/ops.css");
  assert.match(css, /min-width: 1280px/);
  assert.match(css, /\.ops-split:has\(\[data-split-pane\]\) \.ops-split-list/);
  assert.match(css, /\.ops-split-list \{\s*flex: 1 1 auto;\s*min-width: 0;/);
});
