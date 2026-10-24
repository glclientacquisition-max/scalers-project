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
