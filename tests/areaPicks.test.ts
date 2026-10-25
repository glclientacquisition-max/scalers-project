import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = () => import("../dashboard/src/lib/areaPicks.ts");
const tree = JSON.parse(readFileSync(new URL("../dashboard/src/lib/data/kenyaAreaTree.v1.json", import.meta.url), "utf8"));

test("tree is versioned with all 47 counties and unique ids", () => {
  assert.match(tree.version, /^ke-areas-\d{4}-\d{2}-\d{2}\.\d+$/);
  const counties = tree.nodes.filter((n: { kind: string }) => n.kind === "county");
  assert.equal(counties.length, 47);
  const ids = tree.nodes.map((n: { id: string }) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const n of tree.nodes) if (n.parent) assert.ok(ids.includes(n.parent), n.id);
});

test("nearest pick wins, fee and note inherit", async () => {
  const m = await load();
  let p = m.emptyAreaPicks();
  p = m.toggleArea(p, "county:nairobi");
  p = m.toggleArea(p, "estate:nairobi:kibera");
  p = m.setAreaDetail(p, "town:kajiado:kitengela", { serve: true, fee_kes: "500", note: "Weekends only" });
  assert.equal(m.resolveArea(p, "estate:nairobi:kilimani").covered, true);
  assert.equal(m.resolveArea(p, "estate:nairobi:kibera").covered, false);
  assert.equal(m.areaState(p, "county:nairobi"), "part");
  assert.equal(m.areaState(p, "county:kajiado"), "part");
  assert.equal(m.areaRowMeta(p, "county:kajiado"), "Kitengela only");
  assert.equal(m.resolveArea(p, "county:kisumu").covered, false);
  const k = m.resolveArea(p, "town:kajiado:kitengela");
  assert.deepEqual([k.fee_kes, k.note], [500, "Weekends only"]);
  assert.equal(m.callerHears(p, "Kitengela").reply, "Yes, we cover Kitengela. There's an extra KES 500. Weekends only.");
  assert.equal(m.callerHears(p, "Kibra").status, "not_covered");
  assert.equal(m.callerHears(p, "the new mall").status, "not_on_map");
  const s = m.areaSummaryParts(p).map((x) => x.text).join("");
  assert.equal(s, "You cover all of Nairobi except Kibera, plus Kitengela.");
  // toggling a part county turns all of it on and clears child picks
  p = m.toggleArea(p, "county:nairobi");
  assert.equal(m.areaState(p, "county:nairobi"), "on");
  assert.equal(m.areaPick(p, "estate:nairobi:kibera"), null);
});

test("search: prefix, misspelling, alias, landmark", async () => {
  const m = await load();
  const a = m.searchAreaTree("Kilel");
  assert.equal(a.areas[0].label, "Kileleshwa");
  assert.ok(a.didYouMean.some((h) => h.label === "Kilimani"));
  assert.ok(m.searchAreaTree("Kileleswa").didYouMean.some((h) => h.label === "Kileleshwa"));
  assert.ok(m.searchAreaTree("rongai").areas.some((h) => h.label === "Ongata Rongai"));
  assert.ok(m.searchAreaTree("yaya").landmarks.some((h) => h.label === "Yaya Centre"));
  assert.equal(m.matchAreaText("Yaya Centre")?.name, "Kilimani");
});

test("move-over: county/town ambiguity asks, default whole county", async () => {
  const m = await load();
  const mo = m.moveOverAreas(["place:kiambu", "place:juja", "place:kitengela", "county:nairobi", "place:atlantis"]);
  assert.equal(mo.questions.length, 1);
  assert.equal(mo.questions[0].county, "county:kiambu");
  assert.equal(m.resolveArea(mo.picks, "town:kiambu:thika").covered, true);
  assert.equal(mo.rows.find((r) => r.raw === "juja")?.insideOf, "Kiambu");
  assert.deepEqual(mo.unmatched, ["atlantis"]);
  const town = m.moveOverAreas(["place:kiambu"], { "county:kiambu": "town" });
  assert.equal(m.resolveArea(town.picks, "town:kiambu:thika").covered, false);
  assert.equal(m.resolveArea(town.picks, "town:kiambu:kiambu").covered, true);
});

test("normalize drops unknown nodes and clamps fee/note", async () => {
  const m = await load();
  const p = m.normalizeAreaPicks({ picks: [{ node: "nope" }, { node: "county:nairobi", serve: true, fee_kes: -3, note: "  x ".repeat(80) }] });
  assert.equal(p.picks.length, 1);
  assert.equal(p.picks[0].fee_kes, null);
  assert.ok((p.picks[0].note ?? "").length <= m.AREA_NOTE_MAX);
});

test("search: bare 'Sarit' resolves to Westlands via alias", async () => {
  const m = await load();
  const r = m.searchAreaTree("Sarit");
  assert.equal(r.areas[0]?.node.id, "estate:nairobi:westlands");
  assert.equal(m.matchAreaText("Sarit")?.name, "Westlands");
});

test("home summary lists Nairobi first, then the rest by name", async () => {
  const m = await load();
  let p = { version: 1 as const, tree_version: tree.version, picks: [] as never[] } as Parameters<typeof m.areaSummaryParts>[0];
  for (const n of ["county:kiambu", "county:nairobi", "county:kajiado"]) p = m.toggleArea(p, n);
  const parts = m.areaSummaryParts(p).filter((x) => x.strong).map((x) => x.text);
  assert.deepEqual(parts, ["Nairobi", "Kajiado", "Kiambu"]);
});

// ---- coverage confirm, exclusions, conditions (Brain #942) ----
test("one tap excludes a child place inside a covered county", async () => {
  const m = await import("../dashboard/src/lib/areaPicks.ts");
  let p = m.toggleArea(m.emptyAreaPicks(), "county:nairobi");
  p = m.toggleArea(p, "estate:nairobi:kibera");
  assert.deepEqual(m.areaPick(p, "estate:nairobi:kibera"), { node: "estate:nairobi:kibera", serve: false, fee_kes: null, note: null, conditions: [] });
  assert.equal(m.callerHears(p, "Kibera").status, "not_covered");
  assert.equal(m.callerHears(p, "Kilimani").status, "covered");
});

test("min_bedrooms condition is stored, inherited and spoken", async () => {
  const m = await import("../dashboard/src/lib/areaPicks.ts");
  let p = m.toggleArea(m.emptyAreaPicks(), "county:nairobi");
  p = m.setAreaDetail(p, "town:kiambu:thika", { serve: true, fee_kes: "800", note: "", conditions: [{ kind: "min_bedrooms", value: 2 }] });
  const n = m.normalizeAreaPicks(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(m.areaPick(n, "town:kiambu:thika")?.conditions, [{ kind: "min_bedrooms", value: 2 }]);
  assert.equal(m.resolveArea(n, "town:kiambu:thika").fee_kes, 800);
  assert.equal(m.callerHears(n, "Thika").reply, "Yes, we cover Thika. There's an extra KES 800. In Thika we take jobs from 2 bedrooms up.");
  assert.deepEqual(m.cleanConditions([{ kind: "min_bedrooms", value: 0 }, { kind: "bogus", value: 2 }, { kind: "min_bedrooms", value: "3" }]), [{ kind: "min_bedrooms", value: 3 }]);
  // excluding drops conditions
  const off = m.setAreaDetail(n, "town:kiambu:thika", { serve: false, fee_kes: 800, note: "x", conditions: [{ kind: "min_bedrooms", value: 2 }] });
  assert.equal(m.areaPick(off, "town:kiambu:thika")?.conditions?.length ?? 0, 0);
  assert.deepEqual(m.resolveArea(off, "town:kiambu:thika").conditions, []);
});

test("confirm state: none, old_only, unconfirmed, edited, confirmed", async () => {
  const m = await import("../dashboard/src/lib/areaPicks.ts");
  assert.equal(m.areaConfirmState(null, 0), "none");
  assert.equal(m.areaConfirmState(null, 3), "old_only");
  assert.equal(m.areaConfirmState({ confirmed_at: null, updated_at: "2026-10-25T08:00:00Z", pickCount: 2 }, 0), "unconfirmed");
  assert.equal(m.areaConfirmState({ confirmed_at: "2026-10-25T08:00:00Z", updated_at: "2026-10-25T08:00:00Z", pickCount: 2 }, 0), "confirmed");
  assert.equal(m.areaConfirmState({ confirmed_at: "2026-10-25T08:00:00Z", updated_at: "2026-10-25T09:00:00Z", pickCount: 2 }, 0), "edited");
  assert.equal(m.areaNeedsConfirm("edited"), true);
  assert.equal(m.areaNeedsConfirm("confirmed"), false);
});

test("seed from old list: unconfirmed, fees carried, excludes kept, has-picks skipped", async () => {
  const s = await import("../scripts/seed-area-picks-from-old.ts");
  const plan = s.planSeed([
    { id: "a", has_picks: true, service_areas: { areas: [{ id: "place:karen" }] } },
    { id: "b", service_areas: null, coverage_areas: null },
    { id: "c", business_name: "C", service_areas: { areas: [{ id: "county:nairobi" }, { id: "place:kitengela", fee_ksh: 500 }], exclude: ["place:kibera"] } },
  ]);
  assert.equal(plan.skippedHasPicks, 1);
  assert.equal(plan.skippedNoOldList, 1);
  assert.equal(plan.seeded.length, 1);
  const p = plan.seeded[0].picks.picks;
  assert.equal(p.find((x: { node: string }) => x.node === "town:kajiado:kitengela")?.fee_kes, 500);
  assert.equal(p.find((x: { node: string }) => x.node === "estate:nairobi:kibera")?.serve, false);
  const sql = s.seedSql(plan);
  assert.match(sql, /on conflict \(tenant_id\) do nothing;/);
  assert.match(sql, /::jsonb, null, null\)/);
});
