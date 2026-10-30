/** Run: node --experimental-strip-types --test tests/setupChecklist.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHECKLIST_TOTAL, SETUP_CHECKLIST, checklistLabel, checklistProgress } from "../dashboard/src/lib/setupChecklist.ts";
import { SETUP_STEPS } from "../dashboard/src/lib/setupFlow.ts";

test("checklist has 5 items and covers every setup step once", () => {
  assert.equal(CHECKLIST_TOTAL, 5);
  const covered = SETUP_CHECKLIST.flatMap((i) => i.steps);
  assert.deepEqual([...covered].sort(), SETUP_STEPS.map((s) => s.key).sort());
});

test("a new owner starts at 1 of 5 done", () => {
  const p = checklistProgress({ furthestStep: 0 });
  assert.equal(checklistLabel(p.count), "1 of 5 done");
  assert.ok(p.done.has("account"));
  assert.equal(p.current, "business");
});

test("resume keeps the count from the saved step", () => {
  assert.equal(checklistProgress({ furthestStep: 2 }).count, 1);
  assert.equal(checklistProgress({ furthestStep: 3 }).count, 2);
  assert.equal(checklistProgress({ furthestStep: 5 }).count, 3);
  assert.equal(checklistProgress({ furthestStep: 5 }).current, "reach");
});

test("Home: setup done, test call left is 4 of 5; tested is 5 of 5", () => {
  assert.equal(checklistProgress({ furthestStep: 0, setupDone: true }).count, 4);
  assert.equal(checklistProgress({ furthestStep: 0, setupDone: true }).current, "connect");
  assert.equal(checklistProgress({ furthestStep: 0, setupDone: true, lineTested: true }).count, 5);
});

test("setup header and Home card use the checklist count", () => {
  const flow = readFileSync(new URL("../dashboard/src/app/onboarding/SetupFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /checklistLabel\(progress\.count\)/);
  assert.doesNotMatch(flow, /\{index \+ 1\} of \{SETUP_STEPS\.length\}/);
  const card = readFileSync(new URL("../dashboard/src/components/HomeCallSetupCard.tsx", import.meta.url), "utf8");
  assert.match(card, /<SetupChecklist/);
});

test("checklist v2: blue ticks and a progress bar from the same count", () => {
  const ui = readFileSync(new URL("../dashboard/src/components/SetupChecklist.tsx", import.meta.url), "utf8");
  assert.match(ui, /done \? "border-accent bg-accent text-white"/);
  assert.match(ui, /progress\.count \/ CHECKLIST_TOTAL/);
  assert.match(ui, /motion-reduce:transition-none/);
});
