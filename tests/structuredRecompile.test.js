const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("payments save with the Settings page and the prompt is rebuilt from the generated text", () => {
  const actions = readFileSync(join(__dirname, "..", "dashboard/src/app/(desk)/settings/actions.ts"), "utf8");
  // Payments and rules are part of business_policies on the one Settings save (no second Save button).
  assert.match(actions, /applyStructuredPolicies\(businessPolicies\)/);
  assert.ok(actions.indexOf("applyStructuredPolicies(businessPolicies)") < actions.indexOf("formatPoliciesForCompiler(businessPolicies)"), "text generated before compile");
  assert.match(actions, /business_policies: businessPoliciesForStorage\(businessPolicies\)/);
  const structured = readFileSync(join(__dirname, "..", "dashboard/src/app/(desk)/settings/structuredActions.ts"), "utf8");
  assert.doesNotMatch(structured, /savePaymentsAction/);
  const price = structured.slice(structured.indexOf("export async function confirmPriceAction"), structured.indexOf("export async function saveBusinessCategoryAction"));
  assert.match(price, /recompileAfterCatalogImport\(/);
});
