import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const sa = () => import("../dashboard/src/lib/serviceAreas.ts");

test("Add areas drawer: a just-ticked area is ticked, never 'Already added'", async () => {
  const m = await sa();
  const rows = m.areaPickerRows("ruaka", ["place:ruaka"], []);
  assert.deepEqual(rows.alreadyAdded.map((o) => o.id), []);
  assert.ok(rows.options.some((o) => o.id === "place:ruaka"), "ticked area stays in the list, ticked");
  const saved = m.areaPickerRows("ruaka", [], ["place:ruaka"]);
  assert.deepEqual(saved.alreadyAdded.map((o) => o.id), ["place:ruaka"]);
  assert.ok(!saved.options.some((o) => o.id === "place:ruaka"));
  const ed = read("../dashboard/src/components/structured/ServiceAreasEditor.tsx");
  assert.match(ed, /areaPickerRows\(/);
});

test("a dropped connection after a save refetches instead of the page error boundary", () => {
  const form = read("../dashboard/src/components/TenantForm.tsx");
  assert.match(form, /useActionState\(saveSettingsSafely/);
  assert.match(form, /catch[\s\S]{0,300}networkError: true/);
  assert.match(form, /networkError[\s\S]{0,400}router\.refresh\(\)/);
});

test("save path: auth checks and reads run in parallel; after() never throws", () => {
  const src = read("../dashboard/src/app/(desk)/settings/actions.ts");
  assert.match(src, /await Promise\.all\(\[\s*memberDenied\("settings\.edit"\),\s*isAuthenticated\(\),\s*getCurrentTenant\(\),?\s*\]\)/);
  assert.match(src, /await Promise\.all\(\[[\s\S]{0,200}readSavedFactRow[\s\S]{0,200}loadCompileProvenance/);
  const afterBody = src.slice(src.indexOf("after(async () => {"));
  assert.match(afterBody.slice(0, 120), /after\(async \(\) => \{\s*try \{/, "whole after() body is guarded");
  assert.match(afterBody, /PROMPT_UPGRADE_BUDGET_MS/, "model call has a time budget");
  assert.match(src, /settings-save timing/, "server timing is logged so slow steps show in Vercel logs");
});
