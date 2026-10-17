// Fixes from three-features-review.md: insights, call facts, capabilities copy, Updates.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  buildCallInsights,
  countsForInsights,
  isRealQuestion,
  questionKey,
} from "../dashboard/src/lib/callInsights.ts";
import { fixtureFacts } from "../dashboard/src/lib/callInsightsFixture.ts";
import {
  formatBulletinEndLabel,
  normalizeBulletin,
  applyBulletinEdit,
} from "../dashboard/src/lib/dailyBulletin.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

// ---------- 1. Insights ----------
test("insights count only reviewed or owner calls, never legacy or zero-second calls", () => {
  assert.equal(countsForInsights({ source: "review", duration_seconds: 40 } as never), true);
  assert.equal(countsForInsights({ source: "owner", duration_seconds: 40 } as never), true);
  assert.equal(countsForInsights({ source: "legacy", duration_seconds: 40 } as never), false);
  assert.equal(countsForInsights({ source: "review", duration_seconds: 0 } as never), false);
  const good = fixtureFacts(6).map((r) => ({ ...r, source: "review", duration_seconds: 60 }));
  const junk = fixtureFacts(50).map((r, i) => ({ ...r, call_id: `j${i}`, source: i % 2 ? "legacy" : "review", duration_seconds: i % 2 ? 60 : 0 }));
  const i = buildCallInsights([...good, ...junk]);
  assert.equal(i.calls, 6, "only the 6 real reviewed calls count");
});

test("insights: price pushback percentage uses reviewed calls as the total", () => {
  const rows = fixtureFacts(10).map((r, i) => ({ ...r, source: "review", duration_seconds: 30, price_objection: i < 5 }));
  const legacy = fixtureFacts(90).map((r, i) => ({ ...r, call_id: `l${i}`, source: "legacy", duration_seconds: 30, price_objection: null }));
  const s = buildCallInsights([...rows, ...legacy]).sections.find((x) => x.id === "objections")!;
  assert.equal(s.summary, "5 calls, 50% of calls");
});

test("insights: noisy unanswered text is dropped; near-duplicates group", () => {
  assert.equal(isRealQuestion("Water bottle my previous thing, previous dealing."), false);
  assert.equal(isRealQuestion("Do you deliver to Rongai?"), true);
  assert.equal(isRealQuestion("bei ya carpet ni ngapi"), true);
  assert.equal(isRealQuestion("how much for a sofa"), true);
  assert.equal(questionKey("Do you deliver to Rongai?"), questionKey("do you deliver rongai"));
  const rows = fixtureFacts(8).map((r) => ({ ...r, source: "review", duration_seconds: 30, unanswered_question: null as string | null }));
  rows[0].unanswered_question = "Do you deliver to Rongai?";
  rows[1].unanswered_question = "do you deliver rongai";
  rows[2].unanswered_question = "Water bottle my previous thing, previous dealing.";
  const s = buildCallInsights(rows).sections.find((x) => x.id === "unanswered")!;
  assert.equal(s.bars.length, 1);
  assert.equal(s.bars[0].count, 2);
});

test("insights: a question already in FAQs shows as done and leaves the to-do count", () => {
  const rows = fixtureFacts(8).map((r) => ({ ...r, source: "review", duration_seconds: 30, unanswered_question: null as string | null }));
  rows[0].unanswered_question = "Do you deliver to Rongai?";
  rows[1].unanswered_question = "What time do you open on Sunday?";
  const s = buildCallInsights(rows, 30, { faqQuestions: ["Do you deliver in Rongai"] }).sections.find((x) => x.id === "unanswered")!;
  assert.equal(s.bars.find((b) => /Rongai/.test(b.label))!.done, true);
  assert.equal(s.summary, "1 question to add to your FAQs");
});

test("insights: Add answer is a Sheet with the question filled in, saved by a server action", () => {
  const ui = read("dashboard/src/components/insights/CallInsights.tsx");
  assert.match(ui, /Add answer/);
  assert.match(ui, /addFaqFromInsightAction/);
  assert.match(ui, /defaultValue=\{bar\.label\}|useState\(bar\.label\)/);
  assert.match(ui, /In your FAQs/);
  assert.doesNotMatch(ui, /panel=faqs/);
  const act = read("dashboard/src/app/(desk)/home/insightActions.ts");
  assert.match(act, /"use server"/);
  assert.match(act, /memberDenied\("settings\.edit"\)/);
  assert.match(act, /source: "owner"/);
  assert.match(act, /bustTenantCache/);
  const load = read("dashboard/src/lib/callInsightsLoad.ts");
  assert.match(load, /\.in\("source", \["review", "owner"\]\)/);
  assert.match(load, /\.gt\("calls\.duration_seconds", 0\)/);
});

// ---------- 2. Calls ----------
test("callbacks only: no transferred outcome anywhere in the taxonomy; old values map to callback", () => {
  for (const f of ["src/data/taxonomy.json", "dashboard/src/lib/taxonomy.json"]) {
    const t = JSON.parse(read(f));
    assert.ok(!t.outcomes.some((o: { id: string }) => o.id === "transferred"), f);
    assert.ok(!JSON.stringify(t.outcomes).includes("Passed to a person"), f);
  }
  const cf = require("../src/conversation/callFacts.js");
  assert.equal(cf.normalizeCallFacts({ outcome: "transferred" }).outcome, "callback");
});

test("owner confirms each visit: the booking outcome reads as a request, stored key unchanged", () => {
  for (const f of ["src/data/taxonomy.json", "dashboard/src/lib/taxonomy.json"]) {
    const t = JSON.parse(read(f));
    const booking = t.outcomes.find((o: { id: string }) => o.id === "booking");
    assert.equal(booking?.label, "Visit requested", f);
    assert.ok(!t.outcomes.some((o: { label: string }) => /\b(booked|confirmed|scheduled)\b/i.test(o.label)), f);
  }
  const cf = require("../src/conversation/callFacts.js");
  assert.equal(cf.normalizeCallFacts({ outcome: "booking" }).outcome, "booking");
});

test("migration: transferred rows become callback; owner corrections mirror calls; bulletin compare-and-save", () => {
  const dir = path.join(root, "supabase/migrations");
  const f = fs.readdirSync(dir).find((x) => x.includes("three_features"))!;
  assert.ok(f, "migration exists");
  const sql = read(`supabase/migrations/${f}`);
  assert.match(sql, /update public\.call_facts set outcome = 'callback'[^;]*where outcome = 'transferred'/);
  assert.match(sql, /call_facts_outcome_check/);
  assert.doesNotMatch((sql.split("call_facts_outcome_check")[2] ?? "").split(";")[0], /'transferred'/);
  assert.match(sql, /create or replace function public\.correct_call_facts/);
  assert.match(sql, /update public\.calls set\s+primary_intent/);
  assert.match(sql, /resolution = case/);
  assert.match(sql, /create or replace function public\.save_daily_bulletin/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /grant execute on function public\.save_daily_bulletin/);
});

test("call facts rows wrap long labels on phones instead of cutting them", () => {
  const cs = read("dashboard/src/components/ui/ChoiceSheet.tsx");
  assert.match(cs, /wrap\?: boolean/);
  const cfc = read("dashboard/src/components/structured/CallFactsCorrection.tsx");
  assert.equal((cfc.match(/<ChoiceSheet[^>]*\bwrap\b/g) || []).length, 3);
  assert.doesNotMatch(cfc, /truncate/);
});

test("post-call review: timeout grows with the transcript, one retry, status recorded, durable sweep", async () => {
  const r = require("../src/conversation/callTranscriptReview.js");
  assert.equal(r.reviewTimeoutMs(200), 8000);
  assert.ok(r.reviewTimeoutMs(2000) >= 20000, "a 215 s call gets more than 8 s");
  assert.ok(r.reviewTimeoutMs(100000) <= 30000);
  assert.equal(typeof r.sweepUnreviewedCalls, "function");
  // Retry: first generate fails, second succeeds.
  let calls = 0;
  const facts: unknown[] = [];
  const out = await r.runPostCallTranscriptReview(
    { callSid: "HD_x", turns: [{ speaker: "caller", text: "Hello, how much is carpet cleaning for a big carpet please" }, { speaker: "agent", text: "It is 2200." }], derived: {}, summary: {} },
    {
      generateText: async () => {
        calls += 1;
        if (calls === 1) throw new Error("timeout");
        return JSON.stringify({ reason: "Carpet price", needs_human: false, facts: { intent: "price_check", outcome: "info_only" } });
      },
      save: async () => {},
      saveFacts: async (x: unknown) => facts.push(x),
      recordStatus: async () => {},
      delay: async () => {},
    },
  );
  assert.equal(calls, 2);
  assert.equal(out.ok, true);
  assert.equal(facts.length, 1);
  // Failure is recorded on the call so the sweep and a person can see it.
  const seen: unknown[] = [];
  await r.runPostCallTranscriptReview(
    { callSid: "HD_y", turns: [{ speaker: "caller", text: "Hello, how much is carpet cleaning for a big carpet please" }], derived: {}, summary: {} },
    { generateText: async () => { throw new Error("down"); }, save: async () => {}, recordStatus: async (x: unknown) => seen.push(x), delay: async () => {} },
  );
  assert.deepEqual((seen[0] as { status: string }).status, "generate_failed");
  // Sweep runs the review for each unreviewed call it is given.
  const ran: string[] = [];
  const res = await r.sweepUnreviewedCalls({
    findCalls: async () => [{ id: "c1", sautikit_call_sid: "HD_1", resolution: "resolved", primary_intent: "book_visit", summary: {} }],
    review: async (ctx: { callSid: string }) => { ran.push(ctx.callSid); return { ok: true }; },
  });
  assert.deepEqual(ran, ["HD_1"]);
  assert.equal(res.reviewed, 1);
  const server = read("server.js");
  assert.match(server, /sweepUnreviewedCalls/);
  assert.ok(fs.existsSync(path.join(root, "scripts/backfill-call-reviews.js")));
});

// ---------- 3. Capabilities copy ----------
test("capabilities: owner confirms visits, no made-up booking time, locked callbacks still take a message", () => {
  const src = read("dashboard/src/lib/capabilityGates.ts");
  const line = (id: string, key: string) => {
    const block = src.slice(src.indexOf(`id: "${id}"`));
    const m = block.match(new RegExp(`${key}:\\s*(?:hours\\s*\\?[^:]*:\\s*)?\`([^\`]*)\``));
    return m ? m[1] : "";
  };
  assert.match(line("site_visits", "callerHearsLive"), /owner will call to confirm/i);
  assert.doesNotMatch(line("site_visits", "callerHearsLive"), /booked/i);
  const book = line("booking_slots", "callerHearsLive") + line("booking_slots", "callerHearsLocked");
  assert.ok(book.length > 10);
  assert.doesNotMatch(book, /Thursday|\d+\s*(am|pm)/i);
  const locked = line("callbacks", "callerHearsLocked");
  assert.doesNotMatch(locked, /call again/i);
  assert.match(locked, /message/i);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /put you through|connect you|transfer/i);
});

// ---------- 4. Updates ----------
test("updates: each item carries an explicit 'tell every caller' or 'only if asked' choice", () => {
  const [a, b] = normalizeBulletin([
    { id: "1", text: "Closed today", announce: "always" },
    { id: "2", text: "Promo KSh 500", announce: "ask" },
  ]);
  assert.equal(a.announce, "always");
  assert.equal(b.announce, "ask");
});

test("updates: voice prompt follows the owner's choice, not keywords", () => {
  const vb = require("../src/conversation/dailyBulletin.js");
  const now = new Date("2026-10-12T10:00:00Z");
  const p = vb.formatBulletinForPrompt([
    { id: "1", text: "Call-out fee now KSh 500", announce: "always" },
    { id: "2", text: "We are closed on Sunday", announce: "ask" },
  ], now);
  assert.match(p, /\[tell every caller\] Fact: "Call-out fee now KSh 500"/);
  assert.match(p, /\[only if asked\] Fact: "We are closed on Sunday"/);
  assert.doesNotMatch(p, /\[promo\]|\[operational\]/);
  assert.match(p, /first reply/i);
});

test("updates: Pick shows the end time, not only the date", () => {
  const now = new Date("2026-10-12T07:00:00Z"); // 10:00 EAT
  assert.equal(formatBulletinEndLabel("2026-10-13T11:00:00Z", now), "Until tomorrow, 2:00 pm");
  assert.equal(formatBulletinEndLabel("2026-10-12T11:30:00Z", now), "Until 2:30 pm");
  assert.equal(formatBulletinEndLabel("2026-10-15T06:00:00Z", now), "Until Thu 15 Oct, 9:00 am");
  assert.equal(formatBulletinEndLabel("2026-10-12T20:59:59.999Z", now), "Until tonight");
});

test("updates: edit keeps the id and replaces text, choice and window", () => {
  const items = normalizeBulletin([{ id: "x", text: "Happy ustomer week", active: true, announce: "ask" }]);
  const next = applyBulletinEdit(items, "x", { text: "Happy customer week", announce: "always", starts_at: "2026-10-12T07:00:00Z", ends_at: null });
  assert.equal(next[0].id, "x");
  assert.equal(next[0].text, "Happy customer week");
  assert.equal(next[0].announce, "always");
});

test("updates panel: example placeholder, edit, flash of the latest action, two-person guard", () => {
  const ui = read("dashboard/src/components/DailyBulletinPanel.tsx");
  assert.match(ui, /`e\.g\. \$\{callersHearExample\}`/);
  assert.match(ui, /Tell every caller/);
  assert.match(ui, /Only if they ask/);
  assert.match(ui, />\s*Edit\s*</);
  assert.match(ui, /lastAction/);
  const act = read("dashboard/src/app/(desk)/settings/bulletinActions.ts");
  assert.match(act, /export async function editBulletinAction/);
  assert.match(act, /rpc\("save_daily_bulletin"/);
  assert.match(act, /Someone else just changed/);
});

// ---------- Staging click-through fixes ----------
import { bulletinExpiryPreset, formatBulletinComposePreview, endOfEatDay } from "../dashboard/src/lib/dailyBulletin.ts";
import { homeStakes, shopStakes } from "../dashboard/src/lib/baStakes.ts";

test("edit opens on the update's own duration preset", () => {
  const now = new Date("2026-10-12T15:00:00Z");
  assert.equal(bulletinExpiryPreset(endOfEatDay(now, 0), now), "today");
  assert.equal(bulletinExpiryPreset(endOfEatDay(now, 1), now), "tomorrow");
  assert.equal(bulletinExpiryPreset(null, now), "manual");
  assert.equal(bulletinExpiryPreset("2026-10-13T11:00:00Z", now), "schedule");
});

test("Pick summary always names the picked clock time", () => {
  const now = new Date("2026-10-12T15:00:00Z"); // 18:00 EAT
  assert.equal(formatBulletinComposePreview({ expiry: "schedule", endsLocal: "2026-10-12T23:59", now }), "From now. Until 11:59 pm.");
  assert.equal(formatBulletinComposePreview({ expiry: "schedule", endsLocal: "2026-10-13T14:00", now }), "From now. Until tomorrow, 2:00 pm.");
  assert.equal(formatBulletinComposePreview({ expiry: "today", now }), "From now. Until tonight.");
});

test("updates panel: form resets after an edit; clear is optimistic with a pending label", () => {
  const ui = read("dashboard/src/components/DailyBulletinPanel.tsx");
  assert.match(ui, /bulletinExpiryPreset\(/);
  assert.match(ui, /function resetCompose\(/);
  assert.match(ui, /if \(editState\.ok\) \{\s*resetCompose\(\)/);
  assert.match(ui, /clearingId/);
  assert.match(ui, /Clearing…/);
});

test("Updates heading shows the live dot only when an update is live", () => {
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  assert.match(home, /liveBulletinItems\(tenant\.daily_bulletin\)\.length > 0 \? <LivePing \/> : null/);
});

test("will-say preview: a locked action shows what callers hear today, not 'Needs setup'", () => {
  for (const line of [...homeStakes({ services: [], bookingSlotsAllowed: false }), ...shopStakes({ products: [], holdsAllowed: false })]) {
    assert.notEqual(line.answer, "Needs setup", line.question);
  }
  const book = homeStakes({ services: [], bookingSlotsAllowed: false }).at(-1)!;
  assert.equal(book.state, "locked");
  assert.match(book.answer, /owner will call to confirm/i);
});

test("/inbox redirects to /calls", () => {
  const cfg = read("dashboard/next.config.ts");
  assert.match(cfg, /source: "\/inbox", destination: "\/calls"/);
  assert.match(cfg, /source: "\/inbox\/:path\*", destination: "\/calls\/:path\*"/);
});
