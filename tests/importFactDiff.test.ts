// PR 10 (30 Oct): import review per fact (DESK_IMPORT_FACTS): now vs import, FAQ new/same/changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { diffHint, faqDiffs, hoursDiff, locationsDiff, policyDiffs } from "../dashboard/src/lib/importFactDiff.ts";

const tenant = {
  business_hours: "Mon-Sat 8am-6pm",
  hours_schedule: null,
  business_locations: [{ label: "Main", address: "Ngong Rd" }],
  business_policies: { deposit: "50% to book" },
  faqs: [{ question: "Do you work Sundays?", answer: "No." }, { question: "Do you bring soap?", answer: "Yes, we bring everything." }],
};

test("hours and locations: now vs import", () => {
  const h = hoursDiff(tenant, { hoursNotes: "Mon-Sun 7am-8pm" });
  assert.deepEqual(h, { now: "Mon-Sat 8am-6pm", next: "Mon-Sun 7am-8pm", same: false });
  assert.equal(diffHint(h!), "Now: Mon-Sat 8am-6pm. Import: Mon-Sun 7am-8pm");
  assert.equal(hoursDiff(tenant, { hoursNotes: "mon sat 8am 6pm" })?.same, true);
  assert.equal(hoursDiff(tenant, {}), null);
  assert.equal(locationsDiff({ ...tenant, business_locations: [] }, { locations: [{ label: "Shop", address: "Thika" }] })?.now, "Not set");
});

test("policies one row each, only the ones found", () => {
  const rows = policyDiffs(tenant, { policies: { deposit: "30% to book", delivery: "", returns: "7 days" } as never });
  assert.deepEqual(rows.map((r) => [r.label, r.diff.now, r.diff.same]), [["Deposit", "50% to book", false], ["Returns", "Not set", false]]);
});

test("FAQs: new, same, changes", () => {
  const d = faqDiffs(tenant, { faqs: [{ question: "do you work sundays", answer: "no" }, { question: "Do you bring soap?", answer: "No." }, { question: "Is there a call-out fee?", answer: "KSh 500" }] });
  assert.deepEqual(d, ["same", "changes", "new"]);
});

test("wiring is behind DESK_IMPORT_FACTS", () => {
  const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
  assert.match(read("dashboard/src/app/(desk)/settings/page.tsx"), /importFacts=\{deskImportFacts\(\)\}/);
  assert.match(read("dashboard/src/components/KnowledgeIngestPanel.tsx"), /importFacts \? policyDiffs/);
  const act = read("dashboard/src/app/(desk)/settings/ingestActions.ts");
  assert.match(act, /const confirmFacts = deskImportFacts\(\) && factHashModeFromEnv\(\);/);
  assert.ok(act.indexOf("storedBefore = confirmFacts") < act.indexOf('.from("tenants")\n    .update(patch)'));
});
