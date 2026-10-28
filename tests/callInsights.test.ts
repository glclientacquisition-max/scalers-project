import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildCallInsights, MIN_CALLS, hourLabel } from "../dashboard/src/lib/callInsights.ts";
import { fixtureFacts } from "../dashboard/src/lib/callInsightsFixture.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

test("insights: thin data is honest, no charts and no made-up pattern", () => {
  const i = buildCallInsights(fixtureFacts(MIN_CALLS - 1));
  assert.equal(i.ready, false);
  for (const s of i.sections) if (s.id !== "unanswered") assert.equal(s.summary, null, s.id);
  assert.equal(buildCallInsights([]).calls, 0);
});

test("insights: enough calls names the top lost reason, product and hour, with the calls behind each", () => {
  const i = buildCallInsights(fixtureFacts(60));
  assert.equal(i.ready, true);
  const lost = i.sections.find((s) => s.id === "lost")!;
  assert.match(lost.summary!, /^.+: \d+ of \d+$/);
  assert.equal(lost.bars.reduce((a, b) => a + b.count, 0), lost.basis);
  const products = i.sections.find((s) => s.id === "products")!;
  assert.ok(products.bars[0].calls.length === products.bars[0].count);
  const busy = i.sections.find((s) => s.id === "busiest")!;
  assert.deepEqual([...new Set(busy.bars.map((b) => b.group))], ["Part of day", "Day", "Busiest hours"]);
  const lang = i.sections.find((s) => s.id === "language")!;
  assert.match(lang.summary!, /English \d+%/);
});

test("insights: a section with too few calls says so even when the page is ready", () => {
  const rows = fixtureFacts(10).map((r) => ({ ...r, outcome: "info_only", lost_reason: null, price_objection: false, unanswered_question: null }));
  rows[0] = { ...rows[0], outcome: "lost", lost_reason: "out_of_stock" };
  const i = buildCallInsights(rows);
  const lost = i.sections.find((s) => s.id === "lost")!;
  assert.equal(lost.summary, null);
  assert.equal(lost.thin, "1 lost sale so far. A reason shows from 3.");
  assert.equal(i.sections.find((s) => s.id === "objections")!.thin, "No caller has pushed back on price yet.");
  assert.equal(i.sections.find((s) => s.id === "unanswered")!.summary, null);
});

test("insights: one unanswered question is enough to act on; duplicates group", () => {
  const rows = fixtureFacts(8).map((r) => ({ ...r, unanswered_question: null }));
  rows[0].unanswered_question = "Do you deliver to Ruaka?";
  rows[1].unanswered_question = "do you deliver to ruaka";
  const s = buildCallInsights(rows).sections.find((x) => x.id === "unanswered")!;
  assert.equal(s.summary, "1 question to add to your FAQs");
  assert.equal(s.bars[0].count, 2);
});

test("insights: hours are EAT and read like a person", () => {
  assert.equal(hourLabel(18), "6pm to 7pm");
  assert.equal(hourLabel(0), "12am to 1am");
  assert.equal(hourLabel(11), "11am to 12pm");
  const [r] = fixtureFacts(1).map((x) => ({ ...x, hour_eat: null, created_at: "2026-10-11T15:30:00Z" }));
  const busy = buildCallInsights([r]).sections.find((s) => s.id === "busiest")!;
  assert.ok(busy.bars.some((b) => b.label === "6pm to 7pm"));
});

test("insights: Overview wiring uses the kit Sheet and links each call", () => {
  const ui = read("dashboard/src/components/insights/CallInsights.tsx");
  assert.match(ui, /import \{ Sheet \} from "@\/components\/ui\/Sheet"/);
  assert.match(ui, /inboxRecordHref\(c\.callId/);
  assert.doesNotMatch(ui, /text-(xs|sm|lg|xl)\b|uppercase/);
  const home = read("dashboard/src/app/(desk)/home/page.tsx") +
    // D2: usage, insights, call setup and checks stream from their own slots.
    "\n" + read("dashboard/src/components/home/HomeOverviewSlots.tsx");
  assert.match(home, /loadCallInsights\(client, tenant\.id, 30, tenant\.faqs\)/);
  assert.match(home, /insights \? <CallInsights insights=\{insights\} \/> : null/);
  assert.match(home, /<Suspense fallback=\{<HomeInsightsSkeleton \/>\}>/);
});
