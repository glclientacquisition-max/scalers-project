import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as reg from "../dashboard/src/lib/policyRegistry.ts";
import * as rules from "../dashboard/src/lib/policyRules.ts";

const root = path.resolve(import.meta.dirname, "..");
const dash = (p: string) => fs.readFileSync(path.join(root, "dashboard/src", p), "utf8");

test("niches: cleaning, shop and generic exist, and every topic they list is defined", () => {
  for (const id of ["cleaning", "retail", "generic"]) assert.equal(reg.nicheById(id).id, id);
  for (const n of reg.NICHES) for (const s of n.sections) for (const t of s.topics) assert.ok(t === reg.PAYMENT_TOPIC || reg.TOPICS[t], `${n.id}: ${t}`);
});

test("niche pick: vertical, then keyword, else generic", () => {
  assert.equal(reg.nicheFor({ vertical: "retail" }).id, "retail");
  assert.equal(reg.nicheFor({ vertical: "home_services", business_name: "Done and Dusted" }).id, "cleaning");
  assert.equal(reg.nicheFor({ vertical: "home_services", business_name: "Juma Plumbing" }).id, "generic");
});

test("option labels are 1-3 words", () => {
  for (const t of Object.values(reg.TOPICS)) {
    for (const a of reg.answersFor(t)) assert.ok(a.label.split(/\s+/).length <= 3, `${t.id}: ${a.label}`);
    for (const a of t.answers) for (const f of a.follow ?? []) for (const o of f.options) assert.ok(String(o.label).split(/\s+/).length <= 3, `${t.id}.${f.field}: ${o.label}`);
  }
});

test("every topic offers Write my own and Not set, and every non-custom answer has both languages", () => {
  for (const t of Object.values(reg.TOPICS)) {
    const ids = reg.answersFor(t).map((a) => a.id);
    assert.ok(ids.includes(reg.CUSTOM) && ids.includes(reg.NOT_SET), t.id);
    for (const a of t.answers) {
      const r = reg.ruleFromDraft(t, { ...reg.draftFrom(t, null), answer: a.id });
      const line = reg.spokenLine(t, r);
      assert.ok(line.en && line.sw && !/[{}]/.test(line.en + line.sw), `${t.id}.${a.id}: ${JSON.stringify(line)}`);
    }
  }
});

test("mockup lines: cancel yes/deposit, cancel no, refund 7 days", () => {
  const c = reg.TOPICS.cancellation;
  assert.equal(reg.spokenLine(c, { answer: "yes", allowed: true, notice_hours: 24, fee: "deposit_kept" }).en, "You can cancel up to 24 hours before. After that, we keep the deposit.");
  assert.equal(reg.spokenLine(c, { answer: "no", allowed: false }).en, "We don't accept cancellations.");
  assert.equal(reg.spokenLine(c, { answer: "no", allowed: false }).sw, "Hatukubali kughairi.");
  const r = reg.TOPICS.returns;
  assert.equal(reg.spokenLine(r, { answer: "refund", mode: "refund_or_exchange", days: 7, conditions: ["unused", "receipt"] }).en, "We refund or exchange within 7 days if unused, with a receipt.");
  // Older rows without an answer id are matched on their fields.
  assert.equal(reg.answerOf(c, { notice_hours: 24, fee: "none" }), "yes");
  assert.equal(reg.answerOf(reg.TOPICS.warranty, { none: true }), "no");
});

test("own words: Kiswahili optional; empty Kiswahili falls back to the team line", () => {
  const t = reg.TOPICS.no_show;
  const rule = reg.ruleFromDraft(t, { answer: "custom", values: {}, note: "We wait 20 minutes.", note_sw: "", checked: true });
  assert.deepEqual(rule, { answer: "custom", mode: "custom", note: "We wait 20 minutes." });
  assert.deepEqual(reg.spokenLine(t, rule), { en: "We wait 20 minutes.", sw: "Timu itathibitisha." });
  const withSw = reg.ruleFromDraft(t, { answer: "custom", values: {}, note: "We wait 20 minutes.", note_sw: "Tunasubiri dakika 20.", checked: true });
  assert.equal(reg.spokenLine(t, withSw).sw, "Tunasubiri dakika 20.");
});

test("own words checks match screen 05: too long, phone, link, price flag, tick", () => {
  const long = "We wait 20 minutes, then call you before we leave. A KSh 500 fee applies if we leave, call 0712 000 000 or visit our page to rebook another day that suits you better";
  const errs = reg.draftErrors({ answer: "custom", values: {}, note: long, note_sw: "", checked: false });
  const sums = errs.map((e) => e.summary);
  assert.ok(sums.includes(`Too long (${long.length}/160)`));
  assert.ok(sums.includes("Remove the phone number"));
  assert.ok(sums.includes("Remove the link"));
  assert.ok(sums.includes('Tick "Checked"'));
  assert.equal(reg.checkOwnWords(long).price, "KSh 500");
  assert.deepEqual(reg.draftErrors({ answer: "custom", values: {}, note: "We wait 20 minutes.", note_sw: "", checked: true }), []);
  assert.deepEqual(reg.draftErrors({ answer: "yes", values: {}, note: "", note_sw: "", checked: false }), []);
});

test("partial save: one topic's save leaves every other key and topic unchanged", () => {
  const niche = reg.nicheById("cleaning");
  const stored = {
    payment: "Pay by M-Pesa.",
    payments: { methods: ["mpesa_till"] },
    other: "Bring your own ladder.",
    holds: { allowed: "yes" },
    coverage_areas: ["Nairobi"],
    provenance: { payment: { source: "owner", confirmed: true } },
    rules: {
      booking_changes: { answer: "yes", allowed: true, notice_hours: 24 },
      warranty: { answer: "yes", none: false, months: 3 },
    },
    policy_lines: { warranty: { en: "x", sw: "y" } },
    some_future_key: { keep: true },
  };
  const before = structuredClone(stored);
  const p = reg.topicPatch(stored, "cancellation", { answer: "no", allowed: false }, niche);
  const next = reg.applyTopicPatch(stored, p);
  assert.deepEqual(stored, before, "input not mutated");
  for (const k of ["payment", "payments", "other", "holds", "coverage_areas", "some_future_key"]) assert.deepEqual(next[k], before[k as keyof typeof before], k);
  const r = next.rules as Record<string, unknown>;
  assert.deepEqual(r.booking_changes, before.rules.booking_changes);
  assert.deepEqual(r.warranty, before.rules.warranty);
  assert.deepEqual(r.cancellation, { answer: "no", allowed: false });
  assert.deepEqual((next.policy_lines as Record<string, unknown>).warranty, before.policy_lines.warranty);
  assert.equal(next.warranty, undefined, "warranty text key untouched");
  // Cancel, Move and Late share the legacy "cancellation" key: it is rebuilt from both.
  assert.equal(next.cancellation, "We don't accept cancellations. You can move a booking up to 24 hours before.");
  assert.deepEqual((next.provenance as Record<string, unknown>).payment, before.provenance.payment);
  // The patch itself names only one topic, which is all the RPC writes.
  assert.deepEqual(Object.keys(p).sort(), ["line", "rule", "text", "textKey", "topic"]);
  assert.equal(p.topic, "cancellation");
});

test("Not set clears the old sentence", () => {
  const niche = reg.nicheById("cleaning");
  const stored = { warranty: "We give a 3 month guarantee on our work.", rules: { warranty: { answer: "yes", none: false, months: 3 } }, policy_lines: { warranty: { en: "a", sw: "b" } } };
  const next = reg.applyTopicPatch(stored, reg.topicPatch(stored, "warranty", null, niche));
  assert.equal(next.warranty, "");
  assert.equal((next.rules as Record<string, unknown>).warranty, undefined);
  assert.equal((next.policy_lines as Record<string, unknown>).warranty, undefined);
  assert.deepEqual(reg.spokenLine(reg.TOPICS.warranty, null), reg.NOT_SET_LINE);
});

test("a new niche with a new topic works from config alone", () => {
  const topics: Record<string, reg.TopicDef> = {
    ...reg.TOPICS,
    fitting: {
      id: "fitting",
      title: "Fitting",
      screenTitle: "Fitting",
      question: "Free fitting?",
      answers: [
        { id: "yes", label: "Yes", set: { free: true }, follow: [{ field: "visits", label: "Visits", initial: 1, options: [1, 2].map((v) => ({ value: v, label: String(v), speak: { en: `${v} visit${v === 1 ? "" : "s"}`, sw: `ziara ${v}` } })) }], line: { en: "Fitting is free for {visits}.", sw: "Kupima ni bure kwa {visits}." } },
        { id: "no", label: "No", set: { free: false }, line: { en: "Fitting has a fee.", sw: "Kupima kuna ada." } },
      ],
    },
  };
  const tailor: reg.NicheDef = { id: "tailor", label: "Tailor", keywords: ["tailor", "fundi"], sections: [{ id: "orders", label: "Orders", topics: ["fitting", "returns"] }] };
  const niches = [...reg.NICHES, tailor];
  const n = reg.nicheFor({ business_name: "Mama Fundi Tailors" }, niches);
  assert.equal(n.id, "tailor");
  assert.deepEqual(reg.nicheTopics(n, topics).map((t) => t.id), ["fitting", "returns"]);
  const rule = reg.ruleFromDraft(topics.fitting, { ...reg.draftFrom(topics.fitting, null), answer: "yes", values: { visits: 2 } });
  assert.deepEqual(rule, { answer: "yes", free: true, visits: 2 });
  assert.equal(reg.spokenLine(topics.fitting, rule).en, "Fitting is free for 2 visits.");
  const next = reg.applyTopicPatch({}, reg.topicPatch({}, "fitting", rule, n, topics));
  assert.deepEqual((next.policy_lines as Record<string, unknown>).fitting, { en: "Fitting is free for 2 visits.", sw: "Kupima ni bure kwa ziara 2." });
  // The stored rule survives the shared normaliser (no allowlist of topic names).
  assert.deepEqual((rules.normalizeRules(next.rules) as Record<string, unknown>).fitting, { answer: "yes", free: true, visits: 2 });
  // The SQL check accepts any topic key, so no migration per niche.
  const sql = fs.readFileSync(path.join(root, "docs/supabase/policy_topics.sql"), "utf8");
  assert.match(sql, /k !~ '\^\[a-z\]\[a-z0-9_\]\{0,39\}\$'/);
  // The screen has no per-niche code: it reads the registry only.
  const screen = dash("components/policies/PoliciesScreen.tsx");
  assert.ok(!/"cleaning"|"retail"/.test(screen));
});

test("policyRules: cancel allowed:false, guarantee none, custom mode and note_sw survive and speak", () => {
  const n = rules.normalizeRules({
    cancellation: { allowed: false, notice_hours: 24, fee: "none" },
    warranty: { none: true },
    no_show: { mode: "custom", note: "We wait 20 minutes.", note_sw: "Tunasubiri dakika 20." },
    returns: { mode: "custom", note: "Ask us first." },
  });
  assert.equal(n.cancellation?.allowed, false);
  assert.equal(rules.cancellationSentence(n.cancellation!), "We don't accept cancellations.");
  assert.equal(n.warranty?.none, true);
  assert.equal(rules.warrantySentence(n.warranty!), "We don't give a guarantee.");
  assert.equal(n.no_show?.mode, "custom");
  assert.equal(n.no_show?.note_sw, "Tunasubiri dakika 20.");
  assert.equal(rules.noShowSentence(n.no_show!), "We wait 20 minutes.");
  assert.equal(rules.returnsSentence(n.returns!), "Ask us first.");
  assert.deepEqual(rules.validateRules(n), {});
});

test("Policies has no area or fee inputs; it links to Service areas", () => {
  const editor = dash("components/structured/PolicyRulesEditor.tsx");
  assert.ok(!editor.includes("rule-delivery-areas") && !editor.includes("rule-delivery-fee"));
  assert.ok(editor.includes('href="/settings/areas"'));
  assert.ok(dash("components/policies/PoliciesScreen.tsx").includes('href="/settings/areas"'));
});

test("Policies copy: no em dashes, no AI wording", () => {
  const src = dash("lib/policyRegistry.ts") + dash("components/policies/PoliciesScreen.tsx");
  const strings = src.match(/"[^"\n]*"/g) ?? [];
  for (const s of strings) {
    assert.ok(!s.includes("—"), s);
    assert.ok(!/\bAI\b|seamless|effortless|leverage/i.test(s), s);
  }
});
