import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adj = () => import("../dashboard/src/lib/kenyaCountyAdjacency.ts");
const home = () => import("../dashboard/src/lib/businessCounty.ts");
const tree = JSON.parse(readFileSync(new URL("../dashboard/src/lib/data/kenyaAreaTree.v1.json", import.meta.url), "utf8"));
const treeCounties: string[] = tree.nodes.filter((n: { kind: string }) => n.kind === "county").map((n: { id: string }) => n.id);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("adjacency covers all 47 tree counties, ids match the tree", async () => {
  const m = await adj();
  assert.deepEqual(m.adjacencyCountyIds(), [...treeCounties].sort());
  for (const id of treeCounties) assert.ok(m.countyNeighbours(id).length >= 1, id);
});

test("adjacency is symmetric and never self-referencing", async () => {
  const m = await adj();
  for (const id of treeCounties) {
    for (const n of m.countyNeighbours(id)) {
      assert.notEqual(n, id);
      assert.ok(m.countyNeighbours(n).includes(id), `${id} <-> ${n}`);
    }
  }
});

test("known borders", async () => {
  const m = await adj();
  assert.deepEqual([...m.countyNeighbours("county:nairobi")], ["county:kajiado", "county:kiambu", "county:machakos"]);
  assert.deepEqual([...m.countyNeighbours("county:mombasa")], ["county:kilifi", "county:kwale"]);
  assert.ok(m.countyNeighbours("county:kisumu").includes("county:vihiga"));
  assert.ok(!m.countyNeighbours("county:nairobi").includes("county:mombasa"));
  assert.deepEqual(m.nearbyCounties("county:nairobi")[0], "county:nairobi");
  assert.deepEqual(m.nearbyCounties(null), []);
  assert.deepEqual(m.nearbyCounties("county:atlantis"), []);
});

test("business county from area id, place id, text, or unknown", async () => {
  const m = await home();
  assert.equal(m.businessHomeCounty([{ area_id: "county:kiambu", address: "" }]), "county:kiambu");
  assert.equal(m.businessHomeCounty([{ area_id: "county:muranga" }]), "county:muranga");
  assert.equal(m.businessHomeCounty([{ area_id: "county:tana river" }]), "county:tana-river");
  assert.equal(m.businessHomeCounty([{ address: "Opposite Naivas, Westlands, Nairobi" }]), "county:nairobi");
  assert.equal(m.businessHomeCounty([{ address: "Opposite Naivas", landmark: "Kitengela" }]), "county:kajiado");
  assert.equal(m.businessHomeCounty([{ label: "Main", address: "Opposite the big tree" }]), null);
  assert.equal(m.businessHomeCounty([]), null);
  assert.equal(m.businessHomeCounty(null), null);
  // First location that tells wins.
  assert.equal(
    m.businessHomeCounty([{ address: "Shop 4" }, { address: "Nyali, Mombasa" }, { address: "Kisumu" }]),
    "county:mombasa",
  );
});

test("picker wiring: nearby by default, Show all counties, picks stay visible, full list fallback", () => {
  const picker = read("dashboard/src/components/areas/AreaPicker.tsx");
  assert.match(picker, /homeCounty\?: string \| null/);
  assert.match(picker, /nearbyCounties\(homeCounty\)/);
  assert.match(picker, /Show all counties/);
  assert.match(picker, /!nearSet \|\| showAll\s*\?\s*countyOrder/);
  assert.match(picker, /hasPicksIn\(c\.id\)/);
  const settings = read("dashboard/src/app/(desk)/settings/areas/page.tsx");
  assert.match(settings, /businessHomeCounty\(/);
  assert.match(settings, /homeCounty=\{homeCounty\}/);
  const panel = read("dashboard/src/app/onboarding/OnboardingAreasPanel.tsx");
  assert.match(panel, /homeCounty=\{homeCounty\}/);
  for (const src of [picker, panel]) assert.doesNotMatch(src, /[\u2013\u2014]/, "no em or en dashes");
});
