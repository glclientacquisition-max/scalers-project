"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DASH = path.join(ROOT, "dashboard/src");
const helperPath = path.join(DASH, "lib/adminErrors.ts");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function adminUiFiles() {
  const files = [
    ...walkFiles(path.join(DASH, "app/admin")),
    ...walkFiles(path.join(DASH, "app/api/admin")),
    path.join(DASH, "lib/adminErrors.ts"),
    path.join(DASH, "components/AdminSetupError.tsx"),
  ];
  for (const name of fs.readdirSync(path.join(DASH, "components"))) {
    if (/^(Admin|BuyNumber|DidPool|Sautikit)/.test(name) && /\.(ts|tsx)$/.test(name)) {
      files.push(path.join(DASH, "components", name));
    }
  }
  return files;
}

function loadHelper() {
  const script = `
    import { ADMIN_SETUP_INCOMPLETE, adminFacingError } from ${JSON.stringify(helperPath)};
    const cases = [
      ["Could not save.", "Could not save."],
      ["relation did_number_pool does not exist Apply docs/supabase/did_number_pool.sql in Supabase.", ADMIN_SETUP_INCOMPLETE],
      ["Apply docs/supabase/super_admin_ops.sql if tables/RPCs are missing.", ADMIN_SETUP_INCOMPLETE],
      ["No available numbers in the pool", "No available numbers in the pool"],
    ];
    console.log(JSON.stringify({
      fallback: ADMIN_SETUP_INCOMPLETE,
      results: cases.map(([raw]) => adminFacingError(raw)),
    }));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("admin console polish", () => {
  it("never shows docs/supabase or .sql in admin UI or API error copy", () => {
    const leaks = [];
    for (const file of adminUiFiles()) {
      const rel = path.relative(ROOT, file);
      const source = fs.readFileSync(file, "utf8");
      const withoutDetector =
        rel.endsWith("lib/adminErrors.ts")
          ? source.replace(/const INTERNAL[\s\S]*?;/, "")
          : source;
      if (/docs\/supabase/i.test(withoutDetector) || /\.sql\b/.test(withoutDetector)) {
        leaks.push(rel);
      }
    }
    assert.deepEqual(leaks, []);
  });

  it("maps schema failures to a generic setup message and keeps ops copy", () => {
    const { fallback, results } = loadHelper();
    assert.equal(fallback, "Setup is incomplete. Contact support.");
    assert.deepEqual(results, [
      "Could not save.",
      fallback,
      fallback,
      "No available numbers in the pool",
    ]);
  });

  it("uses accent-fill for filled primary CTAs", () => {
    const offenders = [];
    for (const file of adminUiFiles()) {
      const rel = path.relative(ROOT, file);
      const source = fs.readFileSync(file, "utf8");
      if (/bg-\[var\(--accent\)\]/.test(source)) offenders.push(rel);
    }
    assert.deepEqual(offenders, []);
    assert.match(read("dashboard/src/app/admin/(console)/page.tsx"), /ButtonLink/);
    assert.match(read("dashboard/src/components/DidPoolManager.tsx"), /<Button/);
    assert.match(read("dashboard/src/components/AdminBusinessesPanel.tsx"), /<Button/);
    assert.match(read("dashboard/src/components/AdminBillingDetailPanel.tsx"), /<Button/);
    assert.doesNotMatch(read("dashboard/src/components/AdminBillingDetailPanel.tsx"), /btnPrimary/);
    assert.match(read("dashboard/src/components/AdminVoicesManager.tsx"), /btnPrimary/);
    assert.match(read("dashboard/src/components/BuyNumberPanel.tsx"), /ConfirmSheet/);
  });

  it("renders overview attention as ListRow work items", () => {
    const page = read("dashboard/src/app/admin/(console)/page.tsx");
    assert.match(page, /lg:grid-cols-4/);
    assert.match(page, /Needs you/);
    assert.match(page, /ListRow/);
    assert.match(page, /row\.href/);
    assert.match(page, /Nothing waiting\./);
    assert.match(page, /Add a number when a business needs one/);
    assert.doesNotMatch(page, /<table/);
    assert.doesNotMatch(page, /DeskRowHit/);
    assert.doesNotMatch(page, /Manage →/);
  });

  it("lists businesses as ListRows with a shop sheet, assign, and confirmed release", () => {
    const panel = read("dashboard/src/components/AdminBusinessesPanel.tsx");
    assert.match(panel, /ListRow/);
    assert.doesNotMatch(panel, /<table/);
    assert.match(panel, /Notify/);
    assert.match(panel, /Created/);
    assert.match(panel, /whatsapp_notification_number/);
    assert.match(panel, /startsWith\("pending:"\)/);
    assert.match(panel, /Assign next/);
    assert.doesNotMatch(panel, /Assign next available/);
    assert.match(panel, /next === "shop"/);
    assert.match(panel, /SheetNote/);
    assert.match(panel, /type="search"/);
    assert.match(panel, /assign_specific/);
    assert.match(panel, /Add number/);
    assert.match(panel, /No numbers available/);
    assert.match(panel, /Release this number\?/);
    assert.match(panel, /returns to Available/);
    assert.match(panel, /Adjust ledger/);
    assert.match(panel, /b\.package_name/);
    assert.match(panel, /wallet_balance_kes/);
    assert.match(panel, /REMOVE/);
    assert.doesNotMatch(panel, /disabled=\{pending \|\| availableDidCount === 0\}/);
  });

  it("lists DID pool as ListRows with assign, add, and a confirmed release", () => {
    const panel = read("dashboard/src/components/DidPoolManager.tsx");
    assert.match(panel, /ListRow/);
    assert.doesNotMatch(panel, /<table/);
    assert.match(panel, /Add number/);
    assert.match(panel, /Assign next available/);
    assert.match(panel, /assign_specific/);
    assert.match(panel, /No numbers available/);
    assert.match(panel, /action: "release"/);
    assert.match(panel, /Release this number\?/);
    assert.match(panel, /returns to Available/);
    assert.doesNotMatch(panel, /SAUTIKIT_/);
    assert.doesNotMatch(panel, /fingerprint/);
    assert.doesNotMatch(panel, /disabled=\{pending \|\| available === 0\}/);
  });

  it("renders SautiKit diagnostics as a dense table, not a padded card", () => {
    const panel = read("dashboard/src/components/SautikitTelecomPanel.tsx");
    assert.match(panel, /adminThClass/);
    assert.match(panel, /Telecom \(SautiKit\)/);
    assert.match(panel, /Line rental \/ month/);
    assert.match(panel, /getSautikitKeyDiagnostics/);
    assert.doesNotMatch(panel, /rounded-2xl/);
    assert.doesNotMatch(panel, /font-display text-2xl/);
    assert.doesNotMatch(panel, /\bp-6\b/);
    assert.doesNotMatch(panel, /bg-white/);
    assert.doesNotMatch(panel, /—|–/);
  });

  it("uses the desk list title on admin list roots", () => {
    for (const rel of [
      "dashboard/src/app/admin/(console)/wallets/page.tsx",
      "dashboard/src/app/admin/(console)/voices/page.tsx",
    ]) {
      const src = read(rel);
      assert.match(src, /deskListTitleClass/);
    }
    assert.doesNotMatch(read("dashboard/src/app/admin/(console)/platform/page.tsx"), /PageHeader/);
    assert.doesNotMatch(read("dashboard/src/app/admin/(console)/platform/page.tsx"), /deskListTitleClass/);
    assert.doesNotMatch(read("dashboard/src/app/admin/(console)/businesses/page.tsx"), /deskListTitleClass/);
    assert.doesNotMatch(read("dashboard/src/app/admin/(console)/packages/page.tsx"), /deskListTitleClass/);
    const numbers = read("dashboard/src/app/admin/(console)/numbers/page.tsx");
    assert.doesNotMatch(numbers, /deskListTitleClass/);
    assert.doesNotMatch(numbers, /SautikitSyncButton/);
    assert.doesNotMatch(numbers, /BuyNumberPanel/);
    assert.match(numbers, /DidPoolManager/);
  });

  it("opens Packages with assign and Ledger with the wallets panel", () => {
    const packages = read("dashboard/src/app/admin/(console)/packages/page.tsx");
    assert.match(packages, /loadPackageCatalog/);
    assert.doesNotMatch(packages, /deskListTitleClass/);
    assert.doesNotMatch(packages, /catalogOnly/);
    assert.doesNotMatch(packages, /redirect\(/);
    const wallets = read("dashboard/src/app/admin/(console)/wallets/page.tsx");
    assert.match(wallets, /AdminWalletsPanel/);
    assert.match(wallets, /Ledger/);
    assert.match(wallets, /deskListTitleClass/);
    assert.doesNotMatch(wallets, /redirect\(/);
    const overview = read("dashboard/src/app/admin/(console)/page.tsx");
    assert.match(overview, /Add number/);
    assert.match(overview, /href="\/admin\/platform"/);
    assert.doesNotMatch(overview, /href="\/admin\/packages"/);
    assert.match(overview, /evaluatePlatformOps/);
    assert.doesNotMatch(overview, /PlatformRunBoard/);
    assert.doesNotMatch(overview, /href="\/admin\/billing"/);
    const poolApi = read("dashboard/src/app/api/did-pool/route.ts");
    assert.match(poolApi, /action === "release"/);
    assert.match(poolApi, /releaseAssignedDid/);
    assert.match(read("dashboard/src/lib/didPool.ts"), /export async function releaseAssignedDid/);
    const opsApi = read("dashboard/src/app/api/admin/platform-ops/route.ts");
    assert.match(opsApi, /prepare_resend/);
    assert.match(opsApi, /verify_resend/);
    const opsForm = read("dashboard/src/components/AdminPlatformOpsForm.tsx");
    assert.match(opsForm, /id="escalate"/);
    assert.match(opsForm, />People</);
    assert.match(opsForm, /Add person/);
    assert.match(opsForm, /Low money/);
    assert.match(opsForm, /<Sheet/);
    assert.match(opsForm, /<Switch/);
    assert.match(opsForm, /Done/);
    assert.match(opsForm, /Needs you/);
    assert.doesNotMatch(opsForm, /Warn below/);
    assert.doesNotMatch(opsForm, /Mark seen/);
    assert.doesNotMatch(opsForm, /Seen</);
    assert.doesNotMatch(opsForm, /Create domain/);
    assert.doesNotMatch(opsForm, /DNS records/);
    assert.doesNotMatch(opsForm, /Ops mail/);
    assert.doesNotMatch(opsForm, /RESEND_API_KEY/);
    const board = read("dashboard/src/components/PlatformRunBoard.tsx");
    assert.doesNotMatch(board, /KeyDiagnostics/);
    assert.doesNotMatch(board, /SAUTIKIT_API_KEY/);
    const platform = read("dashboard/src/app/admin/(console)/platform/page.tsx");
    assert.match(platform, /AdminOpsNotices/);
    assert.match(platform, /PlatformRunBoard/);
    assert.doesNotMatch(platform, /Infrastructure/);
  });

  it("documents the admin shell as the desk geometry with its own links", () => {
    const master = read("docs/frontend/design-system/MASTER.md");
    assert.match(master, /## Super Admin/);
    assert.match(master, /ADMIN_LINKS/);
    assert.match(master, /Do not copy the ops shell onto `\(desk\)`/);
    assert.doesNotMatch(master, /labeled navy sidebar/);
    const page = read("docs/frontend/design-system/pages/admin.md");
    assert.match(page, /Icon rail on `md\+`/);
    assert.match(page, /Bottom tabs below `md`/);
    assert.doesNotMatch(page, /navy/);
  });
});
