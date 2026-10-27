// Compat mirror: tenant_area_picks -> business_policies.coverage_areas / coverage_outside + service_areas terms.
// Prod Voice (main) reads only the old fields, so picks and the mirror must never drift.
// The prod readers are loaded straight from src/conversation (same files on main and staging).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const prodCoverage = require("../src/conversation/coverageAreas.js");
const prodOutside = require("../src/conversation/outsideAreas.js");
const prodTerms = require("../src/conversation/areaTerms.js");

const mapper = () => import("../dashboard/src/lib/areaPicksToCoverageAreas.ts");
const picksLib = () => import("../dashboard/src/lib/areaPicks.ts");
const tree = JSON.parse(readFileSync(new URL("../dashboard/src/lib/data/kenyaAreaTree.v1.json", import.meta.url), "utf8"));

test("44 of 47 counties have an old id; Wajir, Mandera, Trans Nzoia do not (old index has 44)", async () => {
  const m = await mapper();
  const counties = tree.nodes.filter((n: { kind: string }) => n.kind === "county");
  const missing = counties.filter((n: { id: string }) => !m.oldCoverageId(n.id)).map((n: { id: string }) => n.id).sort();
  assert.deepEqual(missing, ["county:mandera", "county:trans-nzoia", "county:wajir"]);
  assert.equal(m.oldCoverageId("county:muranga"), "county:muranga");
  assert.equal(m.oldCoverageId("county:tharaka-nithi"), "county:tharaka nithi");
  assert.equal(m.oldCoverageId("county:elgeyo-marakwet"), "county:elgeyo marakwet");
});

test("every mapped id survives prod Voice parseCoverageAreas unchanged", async () => {
  const m = await mapper();
  for (const n of tree.nodes) {
    if (n.kind === "country") continue;
    const id = m.oldCoverageId(n.id);
    if (!id) continue;
    assert.deepEqual(prodCoverage.parseCoverageAreas([id]), [id], n.id);
  }
});

test("includes: county, town and estate", async () => {
  const m = await mapper();
  const a = await picksLib();
  let p = a.emptyAreaPicks();
  p = a.toggleArea(p, "county:nairobi");
  p = a.toggleArea(p, "town:kajiado:kitengela");
  p = a.toggleArea(p, "estate:mombasa:nyali");
  const out = m.areaPicksToCoverageAreas(p, { confirmed: true });
  assert.deepEqual(out.coverage_areas, ["county:nairobi", "place:kitengela", "place:nyali"]);
  assert.equal(out.coverage_outside, null);
  assert.deepEqual(out.unmapped, []);
  const policies = m.applyCoverageMirrorToPolicies({ payment: "M-Pesa" }, out);
  assert.equal(policies.payment, "M-Pesa");
  assert.deepEqual(prodCoverage.readCoverageAreas(policies), ["county:nairobi", "place:kitengela", "place:nyali"]);
  assert.equal(prodCoverage.coveredByAreas("Westlands", policies.coverage_areas), true);
  assert.equal(prodCoverage.coveredByAreas("Kitengela", policies.coverage_areas), true);
  assert.equal(prodOutside.readCoverageOutside(policies), null);
});

test("anywhere in Kenya: ke pick becomes coverage_outside; picks it already covers fold away", async () => {
  const m = await mapper();
  const a = await picksLib();
  let p = a.toggleArea(a.emptyAreaPicks(), "county:nairobi");
  p = a.setAreaDetail(p, "ke", { serve: true, fee_kes: 1500, note: null });
  p = a.setAreaDetail(p, "town:kajiado:kitengela", { serve: true, fee_kes: 300, note: null });
  const out = m.areaPicksToCoverageAreas(p, { confirmed: true });
  // Nairobi (no fee) folds into ke; Kitengela keeps its own fee so it stays listed.
  assert.deepEqual(out.coverage_areas, ["place:kitengela"]);
  assert.deepEqual(out.coverage_outside, { anywhere_kenya: true, fee_ksh: 1500 });
  const policies = m.applyCoverageMirrorToPolicies({}, out);
  assert.deepEqual(prodOutside.readCoverageOutside(policies), { feeKsh: 1500 });
  assert.equal(prodOutside.coverageDetail("Westlands", { businessPolicies: policies }), "kenya");
  assert.equal(prodOutside.coverageDetail("Kitengela", { businessPolicies: policies }), "listed");
  const sa = m.applyCoverageMirrorToServiceAreas(null, out);
  assert.equal(sa.anywhere_kenya, true);
  assert.equal(sa.outside_fee_ksh, 1500);
});

test("exclusions cannot be expressed: the county stays listed and the exclusion is reported as lossy", async () => {
  const m = await mapper();
  const a = await picksLib();
  let p = a.toggleArea(a.emptyAreaPicks(), "county:nairobi");
  p = a.toggleArea(p, "estate:nairobi:kibera");
  assert.equal(a.resolveArea(p, "estate:nairobi:kibera").covered, false);
  const out = m.areaPicksToCoverageAreas(p);
  assert.deepEqual(out.coverage_areas, ["county:nairobi"]);
  assert.deepEqual(out.lossy, ["estate:nairobi:kibera"]);
});

test("an exclusion with no covering ancestor is not lossy and adds nothing", async () => {
  const m = await mapper();
  const a = await picksLib();
  const p = a.normalizeAreaPicks({ picks: [{ node: "town:kajiado:kitengela", serve: true }, { node: "county:kiambu", serve: false }] });
  const out = m.areaPicksToCoverageAreas(p);
  assert.deepEqual(out.coverage_areas, ["place:kitengela"]);
  assert.deepEqual(out.lossy, []);
});

test("county default (#973): home county plus neighbours all mirror as counties", async () => {
  const m = await mapper();
  const a = await picksLib();
  const { nearbyCounties } = await import("../dashboard/src/lib/kenyaCountyAdjacency.ts");
  const around = nearbyCounties("county:kajiado");
  assert.ok(around.includes("county:kajiado") && around.length > 1);
  let p = a.emptyAreaPicks();
  for (const c of around) p = a.toggleArea(p, c);
  const out = m.areaPicksToCoverageAreas(p);
  const expected = around.map((c: string) => m.oldCoverageId(c)).filter(Boolean);
  assert.deepEqual([...(out.coverage_areas ?? [])].sort(), [...expected].sort());
  for (const id of out.coverage_areas ?? []) assert.match(id, /^county:/);
});

test("fees: own or inherited fee becomes a fixed term; prod speaks it only once confirmed", async () => {
  const m = await mapper();
  const a = await picksLib();
  let p = a.setAreaDetail(a.emptyAreaPicks(), "county:kajiado", { serve: true, fee_kes: 400, note: "Weekdays only" });
  p = a.setAreaDetail(p, "town:kajiado:kitengela", { serve: true, fee_kes: 250, note: null });
  p = a.toggleArea(p, "county:nairobi");
  const prior = { areas: [{ id: "county:kajiado", modes: ["visit"], eta: "Same day" }], reach: "both", no_premises: true };
  const out = m.areaPicksToCoverageAreas(p, { confirmed: true, vertical: "retail", priorServiceAreas: prior });
  const byId = Object.fromEntries(out.terms.map((t: { id: string }) => [t.id, t]));
  assert.deepEqual(byId["county:kajiado"], { id: "county:kajiado", modes: ["visit"], fee_mode: "fixed", fee_ksh: 400, eta: "Same day", source: "owner", confirmed: true });
  assert.equal(byId["place:kitengela"].fee_ksh, 250);
  assert.equal(byId["county:nairobi"].fee_mode, "ask");
  assert.deepEqual(byId["county:nairobi"].modes, ["delivery"]);
  const sa = m.applyCoverageMirrorToServiceAreas(prior, out);
  assert.equal(sa.no_premises, true, "other service_areas keys stay");
  assert.equal(sa.reach, "both");
  const terms = prodTerms.readAreaTerms(sa, { vertical: "retail", env: { VOICE_AREA_FEES: "on" } });
  const kajiado = terms.areas.find((t: { id: string }) => t.id === "county:kajiado");
  assert.equal(kajiado.trusted, true);
  assert.equal(kajiado.feeKsh, 400);
  // Not confirmed yet: prod says the team confirms the fee.
  const un = m.applyCoverageMirrorToServiceAreas(prior, m.areaPicksToCoverageAreas(p, { confirmed: false, priorServiceAreas: prior }));
  const unTerms = prodTerms.readAreaTerms(un, { env: { VOICE_AREA_FEES: "on" } });
  assert.ok(unTerms.areas.every((t: { trusted: boolean; feeKsh: number | null }) => !t.trusted && t.feeKsh == null));
});

test("unmapped picks are left out and reported", async () => {
  const m = await mapper();
  const a = await picksLib();
  let p = a.toggleArea(a.emptyAreaPicks(), "county:wajir");
  p = a.toggleArea(p, "town:kisumu:kisumu");
  const out = m.areaPicksToCoverageAreas(p);
  assert.deepEqual(out.coverage_areas, []);
  assert.deepEqual(out.unmapped.sort(), ["county:wajir", "town:kisumu:kisumu"]);
});

test("no serving pick removes coverage_areas and coverage_outside (not set, never 'serves nowhere')", async () => {
  const m = await mapper();
  const a = await picksLib();
  const out = m.areaPicksToCoverageAreas(a.emptyAreaPicks());
  assert.equal(out.coverage_areas, null);
  const policies = m.applyCoverageMirrorToPolicies({ coverage_areas: ["county:nairobi"], coverage_outside: { anywhere_kenya: true }, returns: "7 days" }, out);
  assert.equal("coverage_areas" in policies, false);
  assert.equal("coverage_outside" in policies, false);
  assert.equal(policies.returns, "7 days");
  assert.equal(prodCoverage.readCoverageAreas(policies), null);
});

test("over 40 ids: counties kept first, overflow reported, prod parser keeps the same 40", async () => {
  const m = await mapper();
  const a = await picksLib();
  let p = a.emptyAreaPicks();
  for (const n of tree.nodes) if (n.kind === "county") p = a.toggleArea(p, n.id);
  for (const n of tree.nodes) if (n.kind === "town") p = a.setAreaDetail(p, n.id, { serve: true, fee_kes: 100, note: null });
  const out = m.areaPicksToCoverageAreas(p);
  assert.equal(out.overflow, true);
  assert.equal(out.coverage_areas!.length, m.COVERAGE_MIRROR_MAX);
  assert.ok(out.coverage_areas!.slice(0, 40).every((id: string) => id.startsWith("county:")));
  assert.deepEqual(prodCoverage.parseCoverageAreas(out.coverage_areas), out.coverage_areas);
});

test("round trip: an old coverage list moved onto picks mirrors back to the same ids", async () => {
  const m = await mapper();
  const a = await picksLib();
  const old = ["county:nairobi", "county:kiambu", "place:kitengela", "place:syokimau", "place:nyali"];
  const moved = a.moveOverAreas(old);
  const out = m.areaPicksToCoverageAreas(moved.picks);
  assert.deepEqual([...(out.coverage_areas ?? [])].sort(), [...old].sort());
});

// ---- drift guard: every tenant_area_picks write path in dashboard calls the mirror ----

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test("every dashboard write to tenant_area_picks also writes the coverage mirror", () => {
  const root = new URL("../dashboard/src", import.meta.url).pathname;
  const writers: string[] = [];
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    const writes = /from\(\s*["'`]tenant_area_picks["'`]\s*\)[\s\S]{0,80}?\.(insert|upsert|update|delete)\s*\(/.test(src) ||
      /rpc\(\s*["'`][a-z_]*area_pick[a-z_]*["'`]/.test(src);
    if (!writes) continue;
    writers.push(file.slice(root.length + 1));
    assert.match(src, /mirrorCoverageFromPicks\(/, `${file} writes tenant_area_picks without the coverage mirror`);
  }
  assert.deepEqual(writers, ["lib/areaPicks.server.ts"], "a new writer must call mirrorCoverageFromPicks and be listed here");
  const server = readFileSync(join(root, "lib/areaPicks.server.ts"), "utf8");
  const save = server.slice(server.indexOf("export async function saveAreaPicks"), server.indexOf("export async function mirrorCoverageFromPicks"));
  // After the delete, every successful exit of saveAreaPicks goes through the mirror.
  const afterDelete = save.slice(save.indexOf(".delete()"));
  assert.doesNotMatch(afterDelete, /return \{ ok: true \}/, "saveAreaPicks returns ok without mirroring");
  assert.equal((afterDelete.match(/mirrorCoverageFromPicks\(/g) || []).length, 2);
  assert.match(server, /areaPicksToCoverageAreas\(/);
});

test("every Desk save path reaches saveAreaPicks (settings page, onboarding step, confirm nudge)", () => {
  const read = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");
  assert.match(read("app/(desk)/settings/areas/actions.ts"), /saveAreaPicks\(/);
  assert.match(read("app/onboarding/OnboardingAreasPanel.tsx"), /saveAction=\{saveAreaPicksAction\}/);
  assert.match(read("lib/areaConfirmCheck.server.ts"), /\/settings\/areas\?view=check/);
});
