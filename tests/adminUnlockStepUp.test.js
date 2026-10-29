const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("s24: one StepUpSheet + shared open; Unlock never writes domain state; enforce never fakes success", () => {
  const sheet = read("dashboard/src/components/ops/StepUpSheet.tsx");
  assert.match(sheet, /\/api\/admin\/step-up/);
  assert.doesNotMatch(sheet, /did-pool|businesses|Dialog|framer-motion/);
  assert.match(sheet, /does not save by itself/);
  assert.match(sheet, /Authenticator not set up yet/);
  assert.match(sheet, /onObserved/);
  const cta = read("dashboard/src/components/ops/UnlockCta.tsx");
  assert.match(cta, /useOpenAdminUnlock/);
  assert.match(cta, /data-stepup=\{site\}/);
  assert.doesNotMatch(cta, /did-pool|<StepUpSheet/);
  const header = read("dashboard/src/components/admin/AdminHeaderUnlock.tsx");
  assert.match(header, /useAdminUnlockSession/);
  assert.match(header, /data-admin-header-unlock/);
  assert.match(read("dashboard/src/components/AdminAccountMenu.tsx"), /AdminHeaderUnlock/);
  const route = read("dashboard/src/app/api/admin/step-up/route.ts");
  assert.match(route, /requireAdminOperatorWrite/);
  assert.match(route, /requireStepUp\(/);
  assert.match(route, /step_up_enrolment_required/);
  assert.match(route, /httpOnly: true/);
  assert.doesNotMatch(route, /getSupabaseAdmin/);
  // verified:true only after a real code check
  const verifiedAt = route.indexOf("verified: true");
  assert.ok(verifiedAt > route.indexOf("verifyTotp(") && verifiedAt > route.indexOf("consumeBackupCode("));
});

test("s24: Unlock opens StepUpSheet on Numbers, Settings, Payments, Packages, Services, Voices, BusinessPane, Invoices", () => {
  const sites = [
    ["dashboard/src/components/admin/v2/AdminNumbersV2.tsx", /data-stepup="numbers"/],
    ["dashboard/src/components/admin/v2/AdminSettingsHubV2.tsx", /data-stepup="settings"/],
    ["dashboard/src/components/admin/v2/AdminPaymentsV2.tsx", /data-stepup="payments"/],
    ["dashboard/src/components/admin/v2/AdminPackagesV2.tsx", /data-stepup="packages"/],
    ["dashboard/src/components/admin/v2/AdminServicesV2.tsx", /data-stepup="services"/],
    ["dashboard/src/components/admin/v2/AdminVoicesV2.tsx", /data-stepup="voices"/],
    ["dashboard/src/components/admin/v2/BusinessPane.tsx", /data-stepup="business"/],
    ["dashboard/src/components/admin/v2/AdminInvoicesV2.tsx", /data-stepup="invoices"/],
  ];
  for (const [file, re] of sites) {
    const ui = read(file);
    assert.match(ui, /useOpenAdminUnlock|data-stepup=/, file);
    assert.match(ui, re, file);
    assert.doesNotMatch(ui, /setNote\(true\)/, file);
  }
});

test("s24: Services/Voices reveal real edit paths after observe; Settings has no note-only stub", () => {
  const svc = read("dashboard/src/components/admin/v2/AdminServicesV2.tsx");
  assert.match(svc, /AdminPlatformOpsForm/);
  assert.match(svc, /useAdminUnlockSession/);
  assert.match(svc, /data-unlocked-edit="services"/);
  const voices = read("dashboard/src/components/admin/v2/AdminVoicesV2.tsx");
  assert.match(voices, /AdminVoicesManager/);
  assert.match(voices, /data-unlocked-edit="voices"/);
  const settings = read("dashboard/src/components/admin/v2/AdminSettingsHubV2.tsx");
  assert.doesNotMatch(settings, /data-unlock-note/);
  assert.match(settings, /data-stepup="settings"/);
});

test("s24 item6 med: Remove uses busy remove; Audit desktop rows are keyboard reachable", () => {
  const form = read("dashboard/src/components/AdminPlatformOpsForm.tsx");
  assert.match(form, /busyKey: "save" \| "remove"/);
  assert.match(form, /"remove"/);
  const audit = read("dashboard/src/components/admin/v2/AdminAuditV2.tsx");
  assert.match(audit, /tabIndex=\{0\}/);
  assert.match(audit, /onKeyDown/);
});
