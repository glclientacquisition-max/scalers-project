import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("an areas save does not remount the form (sheet stays open)", async () => {
  const m = await import("../dashboard/src/lib/serviceAreas.ts");
  const before = m.policiesFormKey({ returns: "7 days", coverage_areas: ["place:ruaka"] });
  const after = m.policiesFormKey({ returns: "7 days", coverage_areas: ["place:ruaka", "place:kitengela"] });
  assert.equal(before, after, "coverage_areas follows service_areas; it must not change the form key");
  assert.notEqual(before, m.policiesFormKey({ returns: "14 days", coverage_areas: [] }));
  const shell = read("../dashboard/src/components/BusinessSettingsShell.tsx");
  assert.match(shell, /policiesFormKey\(tenant\.business_policies\)/);
  assert.doesNotMatch(shell, /JSON\.stringify\(tenant\.business_policies/);
});

test("every successful save shows the Saved toast, even if the form remounts", () => {
  const form = read("../dashboard/src/components/TenantForm.tsx");
  // Shared save pattern: the toast fires inside the wrapped action, not from an effect.
  assert.match(form, /successMessage: "Saved · training line"/);
  const hook = read("../dashboard/src/components/useFormSave.ts");
  const run = hook.slice(hook.indexOf("const run = useCallback"), hook.indexOf("const [rawState"));
  assert.match(run, /else if \(opts\.successMessage !== false\) notify\(outcome\.message\)/);
  assert.doesNotMatch(form, /notify\(/, "no second toast from the form");
});
