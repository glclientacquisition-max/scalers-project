import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const sa = () => import("../dashboard/src/lib/serviceAreas.ts");
const ca = () => import("../dashboard/src/lib/coverageAreas.ts");

test("save is fast: template prompt in the write, model prompt after the response", () => {
  const src = read("../dashboard/src/app/(desk)/settings/actions.ts");
  const write = src.indexOf('.from("tenants").update(patch');
  const local = src.indexOf("localOnly: true");
  const afterAt = src.indexOf("after(async () => {");
  assert.ok(local > 0 && local < write, "template prompt is compiled before the write");
  assert.ok(afterAt > write, "model compile runs in after()");
  assert.match(src.slice(afterAt), /compileReceptionistPrompt\(compileInput\)/);
  assert.match(src.slice(afterAt), /\.eq\("llm_system_prompt", prompt\)/, "upgrade only if no newer save");
  assert.doesNotMatch(src.slice(afterAt, src.indexOf("});", afterAt + 2000)), /getAuthUser\(\)/, "no cookie reads inside after()");
  const pc = read("../dashboard/src/lib/promptCompiler.ts");
  assert.match(pc, /opts\.localOnly \|\| !process\.env\.GEMINI_API_KEY/);
});

test("unload warning only while edits are unsaved or a save is pending", () => {
  // Shared save pattern: useFormDraft owns the guard; a clean, idle form never asks.
  const hook = read("../dashboard/src/components/useFormSave.ts");
  assert.match(hook, /shouldGuardUnload\(\{ dirty, pending, disabled: guardDisabled \}\)/);
  assert.match(hook, /if \(!guarded\) return;[\s\S]{0,200}beforeunload/);
  assert.doesNotMatch(read("../dashboard/src/components/TenantForm.tsx"), /beforeunload/);
});

test("switching how customers get your service moves every area to that mode (not in mixed)", async () => {
  const m = await sa();
  let v = m.applyFeeToAreas({ ...m.emptyServiceAreas("home_services") }, ["place:ruaka"], { fee_mode: "fixed", fee_ksh: 200, eta: null }, "home_services");
  assert.deepEqual(v.areas[0].modes, ["visit"]);
  v = m.withReach(v, "deliver");
  assert.deepEqual(v.areas[0].modes, ["delivery"]);
  assert.equal(m.areaSummary(v.areas[0]), "Delivery · KSh 200");
  assert.equal(m.serviceAreasSentence(v), "We deliver to Ruaka for KSh 200.");
  const mixed = m.withReach({ ...v, areas: [{ ...v.areas[0], modes: ["visit"] }] }, "both");
  assert.deepEqual(mixed.areas[0].modes, ["visit"], "mixed keeps each area's own choice");
  const stored = m.normalizeServiceAreas({ reach: "deliver", areas: [{ id: "place:ruaka", modes: ["visit"], fee_mode: "free", source: "owner", confirmed: true }] }, "home_services");
  assert.deepEqual(stored.areas[0].modes, ["delivery"], "stored data is read consistently too");
});

test("change fee with differing fees: 'Fees differ', empty amount", async () => {
  const m = await sa();
  let v = m.applyFeeToAreas(m.emptyServiceAreas("retail"), ["place:ruaka", "place:kitengela"], { fee_mode: "fixed", fee_ksh: 300, eta: null }, "retail");
  assert.equal(m.commonFee(v.areas).differ, false);
  assert.equal(m.commonFee(v.areas).fee_ksh, 300);
  v = m.applyFeeToAreas(v, ["place:ruaka"], { fee_mode: "fixed", fee_ksh: 200, eta: null }, "retail");
  const f = m.commonFee(v.areas);
  assert.equal(f.differ, true);
  assert.equal(f.fee_ksh, null);
  // "Fees differ" UI went with ServiceAreasEditor in #964 (43d9870b): AreaPicker sets a fee per area row.
});

test("search: one county per label; added areas say Added", async () => {
  const c = await ca();
  const corner = c.searchAreaOptions("corner", [], 5).find((o) => o.id === "place:corner");
  assert.ok(corner);
  assert.equal(corner.label, "Corner, Kiambu or Nairobi");
  const r = c.searchAreaOptions("ruaka", ["place:ruaka"], 5);
  assert.equal(r[0].id, "place:ruaka");
  assert.equal(r[0].added, true);
  // The "Added" list went with ServiceAreasEditor in #964 (43d9870b); the lib flag stays.
});
