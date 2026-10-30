// Add many polish (30 Oct): undo also puts back found facts; split shifts, per-day hours, unreadable hours, 24/7; extra branches.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildFactCards } from "../dashboard/src/lib/importFactDiff.ts";
import { parseHoursText } from "../dashboard/src/lib/hoursText.ts";
import { tickedFacts } from "../dashboard/src/lib/factCards.ts";
import { FACT_RESTORE_ORDER, factKeysFor, factsChangedSince, mergeFactLog, sameFact } from "../dashboard/src/lib/importUndo.ts";

const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
const base = { business_hours: "", hours_schedule: null, business_locations: [], business_policies: {}, faqs: [] };
const place = (label: string, address: string, landmark = "") => ({ label, address, landmark, directions: "", coverage_notes: "" });

test("split shift: one range per day, first open to last close, unticked with a note", () => {
  const r = parseHoursText("Mon-Fri 8-12 and 2-6, Sat 9am-1pm");
  assert.deepEqual(r?.schedule.days.tue, { open: "08:00", close: "18:00" });
  assert.deepEqual(r?.schedule.days.sat, { open: "09:00", close: "13:00" });
  assert.equal(r?.unsure, true);
  assert.match(r?.note || "", /Split hours are saved as 8 AM to 6 PM/);
  const c = buildFactCards({ tenant: base as never, draft: { hoursNotes: "Mon-Fri 8am-12pm and 2pm-6pm" } as never }).find((x) => x.kind === "hours");
  assert.equal(c?.on, false);
});

test("per-day differences, including except", () => {
  const r = parseHoursText("Mon-Fri 8am-6pm except Wed 10am-6pm, Sat 9am-2pm, Sun closed");
  assert.deepEqual(r?.schedule.days.mon, { open: "08:00", close: "18:00" });
  assert.deepEqual(r?.schedule.days.wed, { open: "10:00", close: "18:00" });
  assert.deepEqual(r?.schedule.days.sat, { open: "09:00", close: "14:00" });
  assert.equal(r?.schedule.days.sun, null);
  assert.equal(r?.unsure, false);
  const d = parseHoursText("Mon 8am-5pm; Tue 9am-6pm");
  assert.deepEqual(d?.schedule.days.tue, { open: "09:00", close: "18:00" });
  assert.equal(d?.schedule.days.wed, null);
});

test("unreadable hours become an unticked Check this card with the raw words, never saved", () => {
  const cards = buildFactCards({ tenant: base as never, draft: { hoursNotes: "Call us anytime, we are flexible" } as never });
  const c = cards.find((x) => x.kind === "hours_check");
  assert.ok(c);
  assert.equal(c?.on, false);
  assert.match(c?.found || "", /Call us anytime, we are flexible/);
  assert.match(c?.note || "", /couldn't read/);
  assert.equal(cards.some((x) => x.kind === "hours"), false);
  assert.deepEqual(tickedFacts(cards, { hours_check: true }).filter((x) => x.kind === "hours_check"), []);
});

test("24/7 is unticked with the confirm note", () => {
  for (const text of ["Open 24/7", "Daily 24 hours"]) {
    const c = buildFactCards({ tenant: base as never, draft: { hoursNotes: text } as never }).find((x) => x.kind === "hours");
    assert.equal(c?.on, false, text);
    assert.match(c?.note || "", /^Confirm you're open all day, every day\./, text);
  }
  const grid = { timezone: "Africa/Nairobi", location: "", days: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "00:00", close: "23:59" }])) };
  const g = buildFactCards({ tenant: base as never, draft: { hoursSchedule: grid } as never }).find((x) => x.kind === "hours");
  assert.equal(g?.on, false);
  assert.match(g?.note || "", /Confirm you're open all day, every day\./);
});

test("several branches: first stays the address card, each extra is an unticked branch card", () => {
  const locations = [place("Main", "Ngong Road, Kilimani"), place("Westlands", "Mpaka Road, Westlands", "Next to Sarit"), place("Karen", "Karen Road, Karen"), place("Dup", "Ngong Rd, Kilimani")];
  const cards = buildFactCards({ tenant: base as never, draft: { locations } as never });
  const a = cards.find((x) => x.kind === "address");
  assert.equal(a?.kind === "address" && a.address, "Ngong Road, Kilimani");
  assert.equal(a?.on, true);
  const b = cards.filter((x) => x.kind === "branch");
  assert.equal(b.length, 2);
  assert.ok(b.every((x) => x.on === false));
  assert.equal(b[0].kind === "branch" && b[0].placeLabel, "Westlands");
  assert.equal(b[0].found, "Mpaka Road, Westlands · Next to Sarit");
  const stored = { ...base, business_locations: [place("Main", "Old Street"), place("W", "Mpaka Road, Westlands")] };
  assert.equal(buildFactCards({ tenant: stored as never, draft: { locations } as never }).filter((x) => x.kind === "branch").length, 1);
});

test("undo log: keys per card kind, first before wins, unchanged keys dropped, edits detected", () => {
  assert.deepEqual(factKeysFor(["payment", "policy"]), ["policies"]);
  assert.deepEqual(factKeysFor(["areas"]).sort(), ["areas", "policies"]);
  assert.deepEqual(factKeysFor(["branch", "hours_check", "x"]), ["locations"]);
  const first = mergeFactLog({}, { hours: null, faqs: [] }, { hours: { a: 1 }, faqs: [] });
  assert.deepEqual(first, { before: { hours: null }, after: { hours: { a: 1 } } });
  const second = mergeFactLog(first, { hours: { a: 1 } }, { hours: { a: 2 } });
  assert.deepEqual(second.before, { hours: null });
  assert.deepEqual(second.after, { hours: { a: 2 } });
  assert.deepEqual(factsChangedSince({ policies: { delivery: "x", provenance: { a: 1 } } }, { policies: { provenance: { a: 2 }, delivery: "x" } }), []);
  assert.deepEqual(factsChangedSince({ faqs: [{ q: 1 }] }, { faqs: [{ q: 2 }] }), ["faqs"]);
  assert.ok(sameFact({ b: 1, a: [1] }, { a: [1], b: 1 }));
  assert.deepEqual(FACT_RESTORE_ORDER.slice(0, 2), ["areas", "policies"]);
});

test("wiring: undo refuses before changing anything, restores from the log not the browser, SQL additive", () => {
  const srv = read("dashboard/src/lib/kbImportRuns.server.ts");
  assert.ok(srv.indexOf("factsChangedSince(") < srv.indexOf('rpc("kb_undo_import"'), "fact check runs before the items undo");
  const acts = read("dashboard/src/app/(desk)/settings/knowledge/factImportActions.ts");
  assert.match(acts, /factBeforeUndo\(t\.id, importId, key\)/);
  assert.match(acts, /memberDenied\("settings\.edit"\)/);
  const screen = read("dashboard/src/components/catalogue/CatalogueScreen.tsx");
  assert.ok(screen.indexOf("actions.factsBegin") < screen.indexOf("actions.saveFact(card)"));
  assert.ok(screen.indexOf("actions.saveFact(card)") < screen.indexOf("actions.factsEnd("));
  const sql = read("docs/supabase/kb_import_runs_facts.sql");
  assert.match(sql, /add column if not exists fact_before jsonb/);
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b/i);
  assert.match(read("dashboard/src/app/(desk)/settings/knowledge/foundFactsActions.ts"), /export async function saveFoundBranchAction/);
});

test("saving steps are real (no timers), reward has no confetti and respects reduced motion, undo has a live mm:ss ring", () => {
  const screen = read("dashboard/src/components/catalogue/CatalogueScreen.tsx");
  const add = screen.slice(screen.indexOf("const add = (mode:"), screen.indexOf("const finishRef"));
  assert.doesNotMatch(add, /setTimeout|wait\(/);
  assert.match(add, /mark\("items", "done"\)/);
  assert.match(screen, /Preparing your shop…/);
  assert.match(screen, /Your shop is ready/);
  assert.doesNotMatch(screen.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""), /confetti/i);
  const css = read("dashboard/src/app/globals.css");
  assert.match(css, /\.desk-check-ring, \.desk-check-mark \{ animation: none/);
  const bar = read("dashboard/src/components/catalogue/ImportUndoBar.tsx");
  assert.match(bar, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/);
  assert.match(bar, /min-h-11 min-w-11/);
  assert.match(bar, /data-undo-outcome/);
});

test("Add many save is not inside a transition, so each saving step renders as it completes", () => {
  const screen = read("dashboard/src/components/catalogue/CatalogueScreen.tsx");
  assert.match(screen, /const add = \(mode: "append" \| "replace"\) =>\n    void \(async \(\) => \{/);
});
