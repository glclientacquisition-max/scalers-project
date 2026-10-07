const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("Settings catalog desk", () => {
  it("TenantForm composes CatalogPanel instead of inline bulk blocks", () => {
    const form = read("dashboard/src/components/TenantForm.tsx");
    assert.match(form, /CatalogPanel/);
    assert.doesNotMatch(form, /CatalogSectionShell/);
    assert.doesNotMatch(form, /parseBulkServices/);
  });

  it("catalog import actions run suggest on parsed products", () => {
    const actions = read("dashboard/src/app/(desk)/settings/catalogActions.ts");
    assert.match(actions, /suggestImportedProducts/);
  });

  it("dev fixture exposes catalogue tab for visual gate", () => {
    const page = read("dashboard/src/app/dev/settings-catalog/page.tsx");
    assert.match(page, /source: "import"/);
    assert.match(page, /pricing_mode: "ask"/);
  });
});
