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
    assert.match(read("dashboard/src/app/admin/page.tsx"), /btnPrimary/);
    assert.match(read("dashboard/src/components/DidPoolManager.tsx"), /btnPrimary/);
    assert.match(read("dashboard/src/components/AdminBusinessesPanel.tsx"), /btnPrimary/);
    assert.match(read("dashboard/src/components/AdminWalletsPanel.tsx"), /btnPrimary/);
    assert.match(read("dashboard/src/components/AdminVoicesManager.tsx"), /btnPrimary/);
    assert.match(
      read("dashboard/src/components/BuyNumberPanel.tsx"),
      /bg-accent-fill[\s\S]*text-accent-on-fill/
    );
  });

  it("renders overview attention as a dense table with row tap", () => {
    const page = read("dashboard/src/app/admin/page.tsx");
    assert.match(page, /lg:grid-cols-4/);
    assert.match(page, /Needs attention/);
    assert.match(page, /<table/);
    assert.match(page, /DeskRowHit/);
    assert.match(page, /href="\/admin\/businesses"/);
    assert.doesNotMatch(page, /Manage →/);
  });

  it("lists businesses in one dense table", () => {
    const panel = read("dashboard/src/components/AdminBusinessesPanel.tsx");
    assert.match(panel, /<table/);
    assert.doesNotMatch(panel, /lg:hidden/);
    assert.match(panel, /Assign next number/);
    assert.match(panel, /Adjust wallet/);
  });

  it("lists DID pool rows in one dense table", () => {
    const panel = read("dashboard/src/components/DidPoolManager.tsx");
    assert.match(panel, /<table/);
    assert.doesNotMatch(panel, /lg:hidden/);
    assert.match(panel, /Add to pool/);
    assert.match(panel, /Assign next available/);
  });

  it("standardizes admin page titles on text-2xl", () => {
    for (const rel of [
      "dashboard/src/app/admin/wallets/page.tsx",
      "dashboard/src/app/admin/voices/page.tsx",
      "dashboard/src/app/admin/businesses/page.tsx",
      "dashboard/src/app/admin/numbers/page.tsx",
    ]) {
      const src = read(rel);
      assert.match(src, /font-display text-2xl tracking-tight/);
      assert.doesNotMatch(src, /font-display text-3xl/);
      assert.doesNotMatch(src, /font-display text-4xl/);
    }
  });
});
