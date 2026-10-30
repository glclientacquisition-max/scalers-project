// Per-row Save: one row pending, the others stay idle. An unchanged Kiswahili name does not save.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  clearRowPending,
  markRowPending,
  planSwDecision,
  rowIsPending,
  rowStillShown,
} from "../dashboard/src/lib/rowPending.ts";
import { addManyRewardLine } from "../dashboard/src/lib/catalogueView.ts";

const read = (p: string) => fs.readFileSync(p, "utf8");

test("one row pending leaves the others idle", () => {
  const pending = markRowPending(markRowPending(new Set<string>(), "sofa"), "carpet");
  clearRowPending(pending, "carpet");
  const after = clearRowPending(pending, "carpet");
  assert.equal(rowIsPending(after, "sofa"), true);
  assert.equal(rowIsPending(after, "carpet"), false);
  assert.equal(rowIsPending(after, "mattress"), false);
  assert.equal(rowStillShown("sofa", new Set(["sofa", "carpet"]), after), true);
  assert.equal(rowStillShown("carpet", new Set(["sofa", "carpet"]), after), false);
  assert.equal(rowStillShown("mattress", new Set(["sofa"]), after), true);
});

test("Kiswahili save does not fire when the name is already that", () => {
  const suggested = { name_sw: null, name_sw_state: "suggested", name_sw_suggested: "Usafi wa sofa" };
  assert.equal(planSwDecision(suggested, "approve").fire, true);
  assert.deepEqual(planSwDecision({ name_sw: "Usafi wa sofa", name_sw_state: "approved", name_sw_suggested: "Usafi wa sofa" }, "approve"), {
    fire: false,
    reason: "unchanged",
  });
  assert.deepEqual(planSwDecision(suggested, "edit", "   "), { fire: false, reason: "empty" });
  assert.equal(planSwDecision(suggested, "edit", "Usafi wa kochi").fire, true);
  assert.deepEqual(
    planSwDecision({ name_sw: "Usafi wa kochi", name_sw_state: "edited", name_sw_suggested: "Usafi wa sofa" }, "edit", "Usafi wa kochi"),
    { fire: false, reason: "unchanged" }
  );
  assert.deepEqual(planSwDecision({ name_sw: null, name_sw_state: "rejected", name_sw_suggested: "Usafi wa sofa" }, "reject"), {
    fire: false,
    reason: "unchanged",
  });
  assert.equal(planSwDecision(suggested, "reject").fire, true);
});

test("Add many finish is one count line", () => {
  assert.equal(addManyRewardLine({ adds: 4, updates: 0, removed: 0, details: 4 }), "4 items · 4 details");
  assert.equal(addManyRewardLine({ adds: 1, updates: 2, removed: 0, details: 0 }), "1 item · 2 updated");
});

test("Kiswahili rows do not share the page pending flag", () => {
  const src = read("dashboard/src/components/catalogue/CatalogueScreen.tsx");
  const block = src.slice(src.indexOf('data-kb-swahili=""'), src.indexOf('data-kb-issues=""'));
  assert.match(block, /data-row-pending=/);
  assert.match(block, /planSwDecision|decideSw\(/);
  assert.doesNotMatch(block, /pending=\{pending\}/);
  assert.match(src, /Live on calls within a minute\./);
  assert.doesNotMatch(src, /You can undo for 10 minutes/);
  assert.doesNotMatch(src, /Callers hear it within a minute/);
  const actions = read("dashboard/src/app/(desk)/settings/knowledge/actions.ts");
  assert.match(actions, /planSwDecision/);
  assert.match(actions, /revalidate: false/);
});

test("price, policy, lead, member and service rows keep pending on the tapped row", () => {
  const prices = read("dashboard/src/components/structured/PriceConfirmCards.tsx");
  assert.match(prices, /data-row-pending=/);
  assert.doesNotMatch(prices, /disabled=\{pending\}/);
  const policies = read("dashboard/src/components/policies/PoliciesSettings.tsx");
  assert.match(policies, /policiesPatchChanges/);
  assert.match(policies, /data-row-pending=/);
  const leads = read("dashboard/src/components/LeadStatusToggle.tsx");
  assert.match(leads, /pendingStep === step.id/);
  assert.doesNotMatch(leads, /pending \? "opacity-60"/);
  const members = read("dashboard/src/components/MembersPanel.tsx");
  assert.doesNotMatch(members, /disabled=\{pending\}/);
  const jobs = read("dashboard/src/components/InboxJobActions.tsx");
  assert.match(jobs, /pendingValue === "confirmed"/);
  assert.doesNotMatch(jobs, /disabled=\{pending\}/);
  const holds = read("dashboard/src/components/RequestStatusToggle.tsx");
  assert.match(holds, /pendingValue === "fulfilled"/);
  assert.doesNotMatch(holds, /disabled=\{pending\}/);
  const speech = read("dashboard/src/components/PronunciationCoach.tsx");
  const review = speech.slice(speech.indexOf("row.primaryAction === \"use\""), speech.indexOf("row.primaryAction === \"use\"") + 1800);
  assert.match(review, /acting\.has\(c\.id\) \? "Saving…" : "Use this"/);
  assert.doesNotMatch(review, /approvePending \? "Saving…"/);
});
