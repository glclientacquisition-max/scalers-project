"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DASH = path.join(ROOT, "dashboard/src");
const read = (rel) => fs.readFileSync(path.join(DASH, rel), "utf8");
const waiting = require("../dashboard/src/lib/adminWaitingModel.ts");
const usage = require("../dashboard/src/lib/packageUsageAlign.ts");
const activity = require("../dashboard/src/lib/adminActivityModel.ts");

describe("Admin cleanup: data honesty", () => {
  const rows = [
    { id: "a", sautikit_virtual_number: "pending:1", is_active: true, archived_at: null },
    { id: "b", sautikit_virtual_number: "pending:2", is_active: null },
    { id: "c", sautikit_virtual_number: "pending:3", is_active: false, archived_at: null },
    { id: "d", sautikit_virtual_number: "pending:4", is_active: true, archived_at: "2026-10-10T00:00:00Z" },
    { id: "e", sautikit_virtual_number: "+254700000000", is_active: true },
  ];

  it("counts waiting once, and never counts an archived business", () => {
    assert.deepEqual(waiting.waitingBusinesses(rows).map((r) => r.id), ["a", "b"]);
    assert.equal(waiting.isArchivedBusiness(rows[3]), true);
  });

  it("Today, Businesses, and Numbers share the one rule", () => {
    assert.match(read("lib/admin.ts"), /pendingFromBusinesses\(businesses\)/);
    assert.match(read("app/admin/(console)/numbers/page.tsx"), /pendingFromBusinesses/);
    assert.match(read("lib/didPool.ts"), /is_active\.is\.null,is_active\.eq\.true/);
  });

  it("never reads 2 of 0", () => {
    assert.equal(usage.usedOfIncluded(2, 0), "2 used, no allowance");
    assert.equal(usage.usedOfIncluded(47, 200), "47 of 200");
  });
});

describe("Admin cleanup: copy", () => {
  it("maps system values in Activity to plain words", () => {
    assert.equal(activity.valueLabel("shared-login"), "Shared ops login");
    assert.equal(activity.valueLabel("migration"), "System update");
    assert.equal(activity.valueLabel("not setup"), "Not set up");
    assert.equal(activity.valueLabel("payment"), "Payment");
    assert.equal(activity.valueLabel("Alvin"), "Alvin");
  });

  it("uses a true minus sign for negative deltas", () => {
    assert.match(read("lib/adminQualityModel.ts"), /\\u2212\$\{body\}/);
  });

  it("says Businesses, not Shops, and drops SKU jargon", () => {
    const packs = read("components/AdminPackagesPanel.tsx");
    assert.doesNotMatch(packs, /label: "Shops"|: "Shops"/);
    assert.doesNotMatch(read("components/AdminBusinessesPanel.tsx"), /Set SKUs/);
  });

  it("never labels the inbound leg Free", () => {
    const panel = read("components/SautikitTelecomPanel.tsx");
    assert.doesNotMatch(panel, /"Free"/);
    assert.match(panel, /inbound leg/);
  });

  it("has no em or en dashes in the touched Admin copy", () => {
    for (const rel of [
      "components/admin/AdminPageHeader.tsx",
      "components/AdminBusinessesPanel.tsx",
      "components/SautikitTelecomPanel.tsx",
      "components/DidPoolManager.tsx",
      "lib/adminActivityModel.ts",
      "lib/adminWaitingModel.ts",
    ]) {
      assert.doesNotMatch(read(rel), /[\u2013\u2014]/, rel);
    }
  });
});

describe("Admin cleanup: layout", () => {
  it("opens business detail as a side panel from md up", () => {
    assert.match(read("components/ui/Sheet.tsx"), /placement\?: "bottom" \| "side"/);
    assert.match(read("components/AdminBusinessesPanel.tsx"), /placement="side"/);
  });

  it("Add number, Buy, and Sync are buttons", () => {
    const src = read("components/DidPoolManager.tsx");
    assert.match(src, /<Button type="button" onClick=\{\(\) => setSheet\("add"\)\}>/);
    assert.doesNotMatch(src, /<ListRow\s+title="Sync"/);
  });

  it("shows one status per business row", () => {
    assert.match(read("components/AdminBusinessesPanel.tsx"), /stamp=\{rowStamp\(b,/);
  });
});
