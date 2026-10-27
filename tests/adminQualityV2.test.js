const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const page = read("dashboard/src/app/admin/(console)/quality/page.tsx");
const ui = read("dashboard/src/components/admin/v2/AdminQualityV2.tsx");

test("quality v2 sits behind ADMIN_V2 and keeps the old index otherwise", () => {
  assert.match(page, /isAdminV2Enabled\(\)[\s\S]*<AdminQualityV2/);
  assert.match(page, /<QualityIndex /);
});

test("call pane is URL driven and loads the call's business for other calls", () => {
  assert.match(page, /sp\.call \? getCallTrace\(sp\.call\)/);
  assert.match(page, /call\?\.businessId \?\? sp\.pane/);
  assert.match(ui, /q\.set\("call", o\.call\)/);
  assert.match(ui, /All calls for/);
});

test("no centred modal, no motion package, no git sha on screen", () => {
  assert.doesNotMatch(ui, /Dialog|framer-motion|motion\//);
  assert.doesNotMatch(ui, /gitSha/);
});
