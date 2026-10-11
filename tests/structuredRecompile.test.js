const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("saving payments or confirming a price rebuilds the Business Assistant prompt", () => {
  const src = readFileSync(join(__dirname, "..", "dashboard/src/app/(desk)/settings/structuredActions.ts"), "utf8");
  const pay = src.slice(src.indexOf("export async function savePaymentsAction"), src.indexOf("export async function confirmPriceAction"));
  assert.match(pay, /recompileAfterCatalogImport\(\{ client: ws\.client, tenant: \{ \.\.\.ws\.tenant, business_policies: next \} \}\)/);
  assert.ok(pay.indexOf("recompileAfterCatalogImport") > pay.indexOf('.update({ business_policies: next })'), "recompile after the write");
  const price = src.slice(src.indexOf("export async function confirmPriceAction"), src.indexOf("export async function saveBusinessCategoryAction"));
  assert.match(price, /recompileAfterCatalogImport\(/);
});
