// Inbox and triage read the owner's corrected Wanted/Result when there is one.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyOwnerFacts, legacyIntentFor, resolutionForOutcome } from "../dashboard/src/lib/ownerCallFacts.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const base = { primaryIntent: "price", resolution: "needs_human" as const };

test("owner facts win: Quote + Callback needed (seed call 7 shape)", () => {
  const out = applyOwnerFacts(base, { intent: "quote_request", outcome: "callback", source: "owner" });
  assert.equal(out.wanted, "Quote");
  assert.equal(out.result, "Callback needed");
  assert.equal(out.resolution, "needs_human");
  assert.equal(out.primaryIntent, "price");
});

test("no owner facts: old fields stay, no label override", () => {
  assert.deepEqual(applyOwnerFacts(base, null), { ...base, wanted: null, result: null });
  assert.deepEqual(applyOwnerFacts(base, { intent: "hours", outcome: "info_only", source: "review" }), { ...base, wanted: null, result: null });
});

test("owner outcome changes how the row is triaged", () => {
  const out = applyOwnerFacts(base, { intent: "hours", outcome: "info_only", source: "owner" });
  assert.equal(out.resolution, "resolved");
  assert.equal(out.primaryIntent, "hours_open");
  assert.equal(resolutionForOutcome("lost"), "unresolved");
  assert.equal(resolutionForOutcome("abandoned"), "abandoned");
  assert.equal(legacyIntentFor("human_request"), "human");
});

test("SQL mirror and TS mapping agree", () => {
  const sql = read("supabase/migrations/20261012210000_three_features.sql");
  for (const [k, v] of [["quote_request", "price"], ["hours", "hours_open"], ["human_request", "human"], ["product_info", "product_inquiry"]]) {
    assert.match(sql, new RegExp(`'${k}' then '${v}'`));
    assert.equal(legacyIntentFor(k), v);
  }
});

test("wiring: Inbox load fetches owner facts; toLead applies them; row label uses Wanted", () => {
  const load = read("dashboard/src/lib/inboxLoad.ts");
  assert.match(load, /from\("call_facts"\)/);
  assert.match(load, /\.eq\("source", "owner"\)/);
  assert.match(load, /toLead\(call, ownerFacts\.get\(call\.id\)\)/);
  const triage = read("dashboard/src/lib/callsTriage.ts");
  assert.match(triage, /applyOwnerFacts\(/);
  const purpose = read("dashboard/src/lib/inboxPurpose.ts");
  assert.match(purpose, /ownerWanted/);
});
