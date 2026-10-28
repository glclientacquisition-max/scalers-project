// Settings remake slice 2: Policies as cards that each save on their own.
// Vertical gating, smart defaults, the one "When customers pay" question, card patches and scopes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const lib = () => import("../dashboard/src/lib/policiesRemake.ts");
const scope = () => import("../dashboard/src/lib/settingsSaveScope.ts");
const facts = () => import("../dashboard/src/lib/factConfirm.ts");
const pay = () => import("../dashboard/src/lib/payments.ts");
const bpol = () => import("../dashboard/src/lib/businessPolicies.ts");

test("vertical gating: services get booking rules and a guarantee, never returns or delivery", async () => {
  const { policiesKind, rulesFor, ruleLabel } = await lib();
  assert.equal(policiesKind({ vertical: "home_services", business_name: "Sparkle Cleaners" }), "services");
  assert.equal(policiesKind({ vertical: "retail", business_name: "Mama Njeri Fabrics" }), "retail");
  assert.equal(policiesKind("home_services"), "services");
  const services = rulesFor("services");
  assert.deepEqual(services, ["cancellation", "booking_changes", "no_show", "warranty"]);
  assert.ok(!services.includes("returns") && !services.includes("delivery"));
  assert.equal(ruleLabel("warranty", "services"), "Guarantee");
  const retail = rulesFor("retail");
  assert.ok(retail.includes("returns") && retail.includes("delivery"));
  assert.ok(!retail.includes("no_show"));
});

test("retail never sees job timings; services see one three-answer question", async () => {
  const { retailTimingOptions, SERVICE_PAY_ANSWERS } = await lib();
  const ids = retailTimingOptions().map((o) => o.id);
  assert.ok(!ids.includes("before_service" as never) && !ids.includes("after_service" as never));
  assert.deepEqual(
    SERVICE_PAY_ANSWERS.map((a) => a.id),
    ["before", "after", "deposit"]
  );
});

test("pay timing mapping round-trips and the deposit % rides only with the third answer", async () => {
  const { servicePayAnswer, timingsForServiceAnswer, DEFAULT_DEPOSIT_PERCENT } = await lib();
  assert.deepEqual(timingsForServiceAnswer("before", 30), { timings: ["before_service"], deposit_percent: null });
  assert.deepEqual(timingsForServiceAnswer("after", 30), { timings: ["after_service"], deposit_percent: null });
  assert.deepEqual(timingsForServiceAnswer("deposit", 30), { timings: ["deposit_then_balance"], deposit_percent: 30 });
  assert.equal(timingsForServiceAnswer("deposit", 0).deposit_percent, DEFAULT_DEPOSIT_PERCENT);
  for (const a of ["before", "after", "deposit"] as const) assert.equal(servicePayAnswer(timingsForServiceAnswer(a, 40)), a);
  // A deposit wins over anything else stored alongside it.
  assert.equal(servicePayAnswer({ timings: ["after_service", "deposit_then_balance"] }), "deposit");
  assert.equal(servicePayAnswer({ timings: ["on_delivery"] }), "after");
  assert.equal(servicePayAnswer({ timings: [] }), null);
  const { validatePayments, emptyPayments } = await pay();
  for (const a of ["before", "after", "deposit"] as const) {
    assert.deepEqual(validatePayments({ ...emptyPayments(), ...timingsForServiceAnswer(a, 50) }), {});
  }
});

test("smart defaults: unset rules read as one suggested sentence; nothing suggested is spoken", async () => {
  const { ruleRows, policiesNiche, payTimingSentence, callersHearLines, defaultRule } = await lib();
  const niche = policiesNiche({ vertical: "home_services", business_name: "Sparkle Cleaners" }, "services");
  const rows = ruleRows({}, "services", niche);
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.equal(r.state, "suggested");
    assert.ok(r.sentence.length > 0);
    assert.ok(!/[\u2013\u2014]/.test(r.sentence), "no en or em dashes");
  }
  assert.ok(defaultRule("cancellation"));
  assert.equal(payTimingSentence(null, "services").suggested, true);
  assert.deepEqual(callersHearLines({}, "services", niche), []);
});

test("old notes are never dropped: hidden topics and old free text stay visible", async () => {
  const { ruleRows, hiddenNotes, policiesNiche, callersHearLines } = await lib();
  const niche = policiesNiche({ vertical: "home_services" }, "services");
  const raw = {
    returns: "Refunds for unused products within 7 days.",
    cancellation: "Cancel a day before for free.",
    provenance: { returns: { source: "owner", confirmed: true }, cancellation: { source: "owner", confirmed: true } },
  };
  const notes = hiddenNotes(raw, "services", niche);
  assert.deepEqual(notes.map((n) => n.topic), ["returns"]);
  const cancel = ruleRows(raw, "services", niche).find((r) => r.topic === "cancellation");
  assert.equal(cancel?.state, "old_text");
  assert.equal(cancel?.sentence, "Cancel a day before for free.");
  const keys = callersHearLines(raw, "services", niche).map((l) => l.key);
  assert.ok(keys.includes("cancellation") && keys.includes("old-returns"));
});

test("card patches: rules move rule, spoken line and text together; undo puts them back", async () => {
  const { applyPoliciesPatch, invertPoliciesPatch, policiesNiche, defaultRule, storedRules, storedLines } = await lib();
  const niche = policiesNiche({ vertical: "home_services" }, "services");
  const before = { other: "Bring your own ladder.", provenance: { other: { source: "owner", confirmed: true } } };
  const patch = { rules: { cancellation: defaultRule("cancellation") } };
  const after = applyPoliciesPatch(before, patch, niche);
  assert.ok(storedRules(after).cancellation);
  assert.ok(storedLines(after).cancellation?.en);
  assert.ok(String(after.cancellation || "").length > 0);
  assert.equal(after.other, "Bring your own ladder.", "other cards' keys stay as stored");
  const undone = applyPoliciesPatch(after, invertPoliciesPatch(before, patch), niche);
  assert.ok(!storedRules(undone).cancellation);
  assert.ok(!storedLines(undone).cancellation);
  assert.equal(String(undone.cancellation || ""), "");
});

test("payments patch marks the owner and clears the Home check", async () => {
  const { applyPoliciesPatch, ownerPathsForPatch, policiesNiche } = await lib();
  const { normalizePayments } = await pay();
  const niche = policiesNiche({ vertical: "retail" }, "retail");
  const p = normalizePayments({ methods: ["mpesa_till"], mpesa_till: "512345", timings: [], source: "parsed", confirmed: false })!;
  const after = applyPoliciesPatch({ payments: p }, { payments: { ...p, source: "owner", confirmed: true } }, niche);
  const stored = (await bpol()).normalizeBusinessPolicies(after).payments;
  assert.equal(stored?.confirmed, true);
  assert.deepEqual(ownerPathsForPatch({ payments: p }).sort(), ["payments.methods", "policies.payment"]);
});

test("server sanitizer keeps only card keys", async () => {
  const { sanitizePoliciesPatch } = await lib();
  const out = sanitizePoliciesPatch({ other: "x", rules: { cancellation: { allowed: true, evil: { a: 1 } }, bogus: {} }, greeting_text: "hi", text: { llm_system_prompt: "x", returns: "" } });
  assert.deepEqual(Object.keys(out).sort(), ["other", "rules", "text"]);
  assert.deepEqual(Object.keys(out.rules || {}), ["cancellation"]);
  assert.ok(!("evil" in (out.rules?.cancellation || {})));
  assert.deepEqual(out.text, { returns: "" });
});

test("save scopes: a policies card never wipes When unsure, and the unsure card never writes policies", async () => {
  const s = await scope();
  const src = read("../dashboard/src/lib/settingsSaveScope.ts");
  assert.match(src, /"policies-rules": \["businessPolicies"\]/);
  assert.match(src, /"policies-unknown": \["unknownAnswerFallback"\]/);
  assert.ok(Array.isArray(s.POLICIES_CARD_SCOPES));
  const f = await facts();
  assert.ok(f);
  const overview = read("../dashboard/src/app/(desk)/settings/overviewActions.ts");
  assert.match(overview, /settings_scope", "policies-rules"/);
});

test("Home payments nudge deep-links to the payments card", async () => {
  const gap = read("../dashboard/src/lib/settingsGapNav.ts");
  assert.match(gap, /#payments/);
  const slots = read("../dashboard/src/components/structured/StructuredSettingsSlots.tsx");
  assert.match(slots, /#payments/);
  assert.doesNotMatch(slots, /Press Save on Policies/);
  const { policiesAnchor } = await lib();
  assert.equal(policiesAnchor("#payments"), "payments");
  assert.equal(policiesAnchor("#nope"), null);
});

test("number fields don't show a red counter at their limit", () => {
  const src = read("../dashboard/src/components/ui/TextField.tsx");
  assert.match(src, /const over = length > \(max as number\)/);
  assert.match(src, /props\.inputMode === "numeric"/);
});

test("Policies UI copy: no en or em dashes, no tenant or shop words", () => {
  for (const f of ["PoliciesSettings.tsx", "policiesSheets.tsx", "policiesKit.tsx"]) {
    const src = read(`../dashboard/src/components/policies/${f}`);
    const strings = [...src.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]);
    for (const s of strings) {
      assert.ok(!/[\u2013\u2014]/.test(s), `${f}: dash in "${s}"`);
      assert.ok(!/\btenant\b/i.test(s), `${f}: tenant in "${s}"`);
    }
  }
});

test("a set fee is spoken with its amount", async () => {
  const { applyPoliciesPatch, policiesNiche, storedLines } = await lib();
  const niche = policiesNiche({ vertical: "home_services" }, "services");
  const after = applyPoliciesPatch({}, { rules: { cancellation: { allowed: true, notice_hours: 24, fee: "flat", fee_ksh: 500 } } }, niche);
  assert.match(storedLines(after).cancellation.en, /fee of KSh 500\./);
  assert.match(storedLines(after).cancellation.sw, /ada ya KSh 500\./);
});
