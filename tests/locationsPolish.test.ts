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
  const fn = form.slice(form.indexOf("async function saveSettingsSafely"), form.indexOf("async function saveSettingsSafely") + 900);
  assert.match(fn, /if \(res\.ok\) notify\("Saved · training line"\)/);
  assert.doesNotMatch(form, /if \(state\.ok\) notify\(/, "no second toast from the effect");
});
