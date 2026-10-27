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

test("unmapped picks are left out and reported; a county-named town uses its index alias", async () => {
  const m = await mapper();
  const a = await picksLib();
  let p = a.toggleArea(a.emptyAreaPicks(), "county:wajir");
  p = a.toggleArea(p, "town:kisumu:kisumu");
  const out = m.areaPicksToCoverageAreas(p);
  assert.deepEqual(out.coverage_areas, ["place:kisumu central"]);
  assert.deepEqual(out.unmapped, ["county:wajir"]);
  assert.equal(out.failClosed, false);
});

test("D2 Wajir-only business: nothing reaches the line, fail closed (no write, stale list kept, owner warned)", async () => {
  const m = await mapper();
  const a = await picksLib();
  const p = a.toggleArea(a.emptyAreaPicks(), "county:wajir");
  const out = m.areaPicksToCoverageAreas(p, { priorCoverage: ["county:nairobi"], priorPicks: a.toggleArea(a.emptyAreaPicks(), "county:nairobi") });
  // Nairobi was removed by the owner, Wajir has no old id: nothing left, no anywhere-Kenya.
  assert.equal(out.failClosed, true);
  assert.equal(out.coverage_areas, null);
  assert.deepEqual(out.unmapped, ["county:wajir"]);
  const fresh = m.areaPicksToCoverageAreas(p);
  assert.equal(fresh.failClosed, true, "Wajir alone, no prior list: still fail closed, never []");
  assert.deepEqual(m.areaLineNotes(p), { yesStill: [], notOnLine: ["Wajir"], nothingReaches: true });
});

test("Done and Dusted: Kiambu town (KSh 800) mirrors to place:kiambu cbd with its fee, not the whole county", async () => {
  const m = await mapper();
  const a = await picksLib();
  assert.equal(m.oldCoverageId("town:kiambu:kiambu"), "place:kiambu cbd");
  let p = a.toggleArea(a.emptyAreaPicks(), "county:nairobi");
  p = a.setAreaDetail(p, "town:kiambu:kiambu", { serve: true, fee_kes: 800, note: null });
  const out = m.areaPicksToCoverageAreas(p, { confirmed: true });
  assert.deepEqual(out.coverage_areas, ["county:nairobi", "place:kiambu cbd"]);
  assert.ok(!out.coverage_areas!.includes("county:kiambu"));
  assert.deepEqual(out.unmapped, []);
  const sa = m.applyCoverageMirrorToServiceAreas({}, out);
  const terms = prodTerms.readAreaTerms(sa, { env: { VOICE_AREA_FEES: "on" } });
  const kiambu = terms.areas.find((t: { id: string }) => t.id === "place:kiambu cbd");
  assert.equal(kiambu.feeKsh, 800);
  assert.equal(prodCoverage.coveredByAreas("Kiambu CBD", out.coverage_areas), true);
});

test("other county-named towns use index aliases (nakuru town, kisii cbd, bungoma town centre); Kwale town has none", async () => {
  const m = await mapper();
  assert.equal(m.oldCoverageId("town:nakuru:nakuru"), "place:nakuru town");
  assert.equal(m.oldCoverageId("town:kisii:kisii"), "place:kisii cbd");
  assert.equal(m.oldCoverageId("town:bungoma:bungoma"), "place:bungoma town centre");
  assert.equal(m.oldCoverageId("town:kwale:kwale"), null);
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

// ---- lossless: a save never drops an existing county or home area unless the owner removed it ----

const BACKFILL_KE = { version: 1, tree_version: "ke-areas-2026-10-24.1", picks: [{ node: "ke", serve: true, fee_kes: null, note: null }] };

for (const [tenant, prior, probe] of [
  ["ALFAAL (Nairobi)", ["county:nairobi"], "Westlands"],
  ["Esga (Nakuru town)", ["place:nakuru town"], "Nakuru town"],
  ["Grow Tech (Nakuru county)", ["county:nakuru"], "Naivasha"],
] as const) {
  test(`prod backfill ${tenant}: ke-only picks, owner saves unchanged, the named area stays in coverage_areas`, async () => {
    const m = await mapper();
    const a = await picksLib();
    const picks = a.normalizeAreaPicks(BACKFILL_KE);
    const out = m.areaPicksToCoverageAreas(picks, { confirmed: true, priorCoverage: [...prior], priorPicks: picks });
    assert.deepEqual(out.coverage_areas, [...prior]);
    assert.deepEqual(out.coverage_outside, { anywhere_kenya: true, fee_ksh: null });
    assert.deepEqual(out.kept, [...prior]);
    assert.deepEqual(out.dropped, []);
    const policies = m.applyCoverageMirrorToPolicies({ coverage_areas: [...prior], coverage_outside: { anywhere_kenya: true } }, out);
    assert.deepEqual(prodCoverage.readCoverageAreas(policies), [...prior]);
    assert.equal(prodOutside.coverageDetail(probe, { businessPolicies: policies }), "listed");
  });
}

test("Nairobi: ['county:nairobi'] + backfilled ke; owner adds Kitengela with a fee and saves; county:nairobi still listed", async () => {
  const m = await mapper();
  const a = await picksLib();
  const before = a.normalizeAreaPicks(BACKFILL_KE);
  const after = a.setAreaDetail(before, "town:kajiado:kitengela", { serve: true, fee_kes: 300, note: null });
  const out = m.areaPicksToCoverageAreas(after, { confirmed: false, priorCoverage: ["county:nairobi"], priorPicks: before });
  assert.ok(out.coverage_areas!.includes("county:nairobi"));
  assert.deepEqual(out.coverage_areas, ["county:nairobi", "place:kitengela"]);
});

test("no picks row yet: the old list the page showed counts as the prior picks; nothing named is lost", async () => {
  const m = await mapper();
  const a = await picksLib();
  const old = ["county:nairobi", "place:juja"];
  const shown = a.moveOverAreas(old).picks;
  const saved = a.toggleArea(shown, "county:kajiado");
  const out = m.areaPicksToCoverageAreas(saved, { priorCoverage: old, priorPicks: shown });
  assert.deepEqual(out.coverage_areas, ["county:nairobi", "place:juja", "county:kajiado"]);
});

test("owner removal is the only drop: covered before this save, not covered now", async () => {
  const m = await mapper();
  const a = await picksLib();
  let before = a.toggleArea(a.emptyAreaPicks(), "county:nairobi");
  before = a.toggleArea(before, "county:kiambu");
  const after = a.toggleArea(before, "county:nairobi");
  const out = m.areaPicksToCoverageAreas(after, { priorCoverage: ["county:nairobi", "county:kiambu"], priorPicks: before });
  assert.deepEqual(out.coverage_areas, ["county:kiambu"]);
  assert.deepEqual(out.dropped, ["county:nairobi"]);
  // Unticking Nairobi under a backfilled ke is also an owner removal.
  const ke = a.normalizeAreaPicks(BACKFILL_KE);
  const offNairobi = a.toggleArea(ke, "county:nairobi");
  const out2 = m.areaPicksToCoverageAreas(offNairobi, { priorCoverage: ["county:nairobi"], priorPicks: ke });
  assert.deepEqual(out2.dropped, ["county:nairobi"]);
  assert.deepEqual(out2.coverage_areas, [], "ke-only with no anchor: [] (never null, null hides the outside line)");
  assert.equal(out2.anchorless, true);
});

test("a prior id the old picks never covered, or the tree cannot place, is kept", async () => {
  const m = await mapper();
  const a = await picksLib();
  const index = JSON.parse(readFileSync(new URL("../dashboard/src/lib/data/kenyaPlaceCounties.json", import.meta.url), "utf8"));
  const offTree = Object.keys(index.places).map((k) => `place:${k}`).find((id) => !index.counties.includes(id.slice(6)) && !m.nodeForOldId(id))!;
  assert.ok(offTree, "an index place with no tree node");
  const picks = a.toggleArea(a.emptyAreaPicks(), "county:kiambu");
  const out = m.areaPicksToCoverageAreas(picks, { priorCoverage: ["county:nairobi", offTree], priorPicks: a.emptyAreaPicks() });
  assert.deepEqual(out.coverage_areas, ["county:nairobi", offTree, "county:kiambu"]);
  assert.deepEqual(out.dropped, []);
  const prior = { areas: [{ id: offTree, modes: ["visit"], fee_mode: "fixed", fee_ksh: 500, eta: null, source: "owner", confirmed: true }] };
  const withTerms = m.areaPicksToCoverageAreas(picks, { priorCoverage: [offTree], priorPicks: a.emptyAreaPicks(), priorServiceAreas: prior });
  assert.equal(withTerms.terms.find((t: { id: string }) => t.id === offTree).fee_ksh, 500, "unplaceable id keeps its old terms");
});

test("kept ids come first, so the 40 cap never drops a prior area", async () => {
  const m = await mapper();
  const a = await picksLib();
  let p = a.emptyAreaPicks();
  for (const n of tree.nodes) if (n.kind === "town") p = a.setAreaDetail(p, n.id, { serve: true, fee_kes: 100, note: null });
  p = a.toggleArea(p, "county:nairobi");
  const out = m.areaPicksToCoverageAreas(p, { priorCoverage: ["place:juja", "county:nairobi"], priorPicks: p });
  assert.equal(out.overflow, true);
  assert.deepEqual(out.coverage_areas!.slice(0, 2), ["place:juja", "county:nairobi"]);
});

test("D1 Nairobi ke-only: no prior coverage, anchor from the ke row's moved_from", async () => {
  const m = await mapper();
  const a = await picksLib();
  const picks = a.normalizeAreaPicks(BACKFILL_KE);
  const out = m.areaPicksToCoverageAreas(picks, { movedFrom: ["county:nairobi"], homeCounty: "county:kajiado" });
  assert.deepEqual(out.coverage_areas, ["county:nairobi"]);
  assert.deepEqual(out.anchor, { ids: ["county:nairobi"], from: "moved_from" });
  assert.deepEqual(out.coverage_outside, { anywhere_kenya: true, fee_ksh: null });
  const policies = m.applyCoverageMirrorToPolicies({}, out);
  assert.equal(prodOutside.coverageDetail("Westlands", { businessPolicies: policies }), "listed", "home area books directly");
  assert.equal(prodOutside.coverageDetail("Kisumu", { businessPolicies: policies }), "kenya");
});

test("D1 ke-only, nothing moved over: the business county is the last-resort anchor and takes ke's fee", async () => {
  const m = await mapper();
  const a = await picksLib();
  const picks = a.setAreaDetail(a.emptyAreaPicks(), "ke", { serve: true, fee_kes: 1500, note: null });
  const out = m.areaPicksToCoverageAreas(picks, { homeCounty: "county:nairobi", confirmed: true });
  assert.deepEqual(out.coverage_areas, ["county:nairobi"]);
  assert.deepEqual(out.anchor, { ids: ["county:nairobi"], from: "business_county" });
  assert.equal(out.terms[0].fee_ksh, 1500);
  const none = m.areaPicksToCoverageAreas(picks, {});
  assert.deepEqual(none.coverage_areas, []);
  assert.equal(none.anchorless, true);
});

test("D1 never resurrects an excluded area as the anchor", async () => {
  const m = await mapper();
  const a = await picksLib();
  let picks = a.normalizeAreaPicks(BACKFILL_KE);
  picks = a.toggleArea(picks, "county:nairobi");
  const out = m.areaPicksToCoverageAreas(picks, { priorCoverage: ["county:nairobi"], priorPicks: a.normalizeAreaPicks(BACKFILL_KE), movedFrom: ["county:nairobi"], homeCounty: "county:nairobi" });
  assert.ok(!out.coverage_areas!.includes("county:nairobi"));
  assert.equal(out.anchorless, true);
});

test("D3 banner names: excluded places callers still hear yes for", async () => {
  const m = await mapper();
  const a = await picksLib();
  let p = a.toggleArea(a.emptyAreaPicks(), "county:nairobi");
  p = a.toggleArea(p, "estate:nairobi:kibera");
  assert.deepEqual(m.areaLineNotes(p), { yesStill: ["Kibera"], notOnLine: [], nothingReaches: false });
  const picker = readFileSync(new URL("../dashboard/src/components/areas/AreaPicker.tsx", import.meta.url), "utf8");
  assert.match(picker, /areaLineNotes\(saved\)/);
  assert.match(picker, /data-area-line-note/);
  assert.doesNotMatch(picker.slice(picker.indexOf("const lineNote")), /[\u2013\u2014]/, "no en or em dashes in UI copy");
});

// ---- upsert then prune: a failed write never leaves the tenant with fewer picks ----

type Row = { tenant_id: string; node: string; [k: string]: unknown };
function fakeTable(rows: Row[], fail: { upsert?: boolean; prune?: boolean } = {}) {
  const calls: string[] = [];
  const client = {
    from() {
      return {
        upsert(next: Row[]) {
          calls.push("upsert");
          if (fail.upsert) return Promise.resolve({ error: { message: "insert failed" } });
          for (const r of next) {
            const i = rows.findIndex((x) => x.tenant_id === r.tenant_id && x.node === r.node);
            if (i >= 0) rows[i] = r;
            else rows.push(r);
          }
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(_c: string, tenant: string) {
              const all = () => {
                calls.push("delete-all");
                for (let i = rows.length - 1; i >= 0; i--) if (rows[i].tenant_id === tenant) rows.splice(i, 1);
                return { error: null };
              };
              // Delete-all runs only when awaited directly; .not() narrows it to a prune.
              let used = false;
              const lazy = {
                then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
                  if (used) return Promise.resolve({ error: null }).then(res, rej);
                  used = true;
                  return Promise.resolve(all()).then(res, rej);
                },
                not(_c: string, _op: string, list: string) {
                  used = true;
                  calls.push("prune");
                  if (fail.prune) return Promise.resolve({ error: { message: "prune failed" } });
                  const keep = new Set(JSON.parse(`[${list.slice(1, -1)}]`));
                  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].tenant_id === tenant && !keep.has(rows[i].node)) rows.splice(i, 1);
                  return Promise.resolve({ error: null });
                },
              };
              return lazy;
            },
          };
        },
      };
    },
  };
  return { client, calls, rows };
}

const row = (tenant: string, node: string) => ({
  tenant_id: tenant, node, serve: true, fee_kes: null, note: null, confirmed_at: null,
  tree_version: "ke-areas-2026-10-24.1", moved_from: null, updated_at: "now", updated_by: null,
});

test("failed insert (upsert) leaves the old picks in place and never deletes", async () => {
  const { writeAreaPickRows } = await import("../dashboard/src/lib/areaPicksWrite.ts");
  const t = fakeTable([row("t1", "county:nairobi"), row("t1", "county:kiambu"), row("t2", "ke")], { upsert: true });
  const res = await writeAreaPickRows(t.client as never, "t1", [row("t1", "county:kajiado")]);
  assert.deepEqual(res, { ok: false, error: "insert failed", stage: "upsert" });
  assert.deepEqual(t.calls, ["upsert"]);
  assert.deepEqual(t.rows.filter((r) => r.tenant_id === "t1").map((r) => r.node), ["county:nairobi", "county:kiambu"]);
});

test("upsert then prune: new picks in, removed picks out, other tenants untouched", async () => {
  const { writeAreaPickRows } = await import("../dashboard/src/lib/areaPicksWrite.ts");
  const t = fakeTable([row("t1", "county:nairobi"), row("t1", "county:kiambu"), row("t2", "county:nairobi")]);
  const res = await writeAreaPickRows(t.client as never, "t1", [row("t1", "county:kiambu"), row("t1", "estate:nairobi:kibera")]);
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(t.calls, ["upsert", "prune"]);
  assert.deepEqual(t.rows.filter((r) => r.tenant_id === "t1").map((r) => r.node).sort(), ["county:kiambu", "estate:nairobi:kibera"]);
  assert.deepEqual(t.rows.filter((r) => r.tenant_id === "t2").map((r) => r.node), ["county:nairobi"]);
});

test("prune failure keeps every new pick and reports the error", async () => {
  const { writeAreaPickRows } = await import("../dashboard/src/lib/areaPicksWrite.ts");
  const t = fakeTable([row("t1", "county:nairobi")], { prune: true });
  const res = await writeAreaPickRows(t.client as never, "t1", [row("t1", "county:kiambu")]);
  assert.equal(res.ok, false);
  assert.ok(t.rows.some((r) => r.node === "county:kiambu"));
});

test("clearing every pick deletes only that tenant's rows", async () => {
  const { writeAreaPickRows } = await import("../dashboard/src/lib/areaPicksWrite.ts");
  const t = fakeTable([row("t1", "county:nairobi"), row("t2", "ke")]);
  assert.deepEqual(await writeAreaPickRows(t.client as never, "t1", []), { ok: true });
  assert.deepEqual(t.rows.map((r) => r.tenant_id), ["t2"]);
});

test("postgrestInList quotes node ids", async () => {
  const { postgrestInList } = await import("../dashboard/src/lib/areaPicksWrite.ts");
  assert.equal(postgrestInList(["county:nairobi", "estate:nairobi:kibera"]), '("county:nairobi","estate:nairobi:kibera")');
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
  const direct: string[] = [];
  const callers: string[] = [];
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(root.length + 1);
    const writes = /from\(\s*["'`]tenant_area_picks["'`]\s*\)[\s\S]{0,80}?\.(insert|upsert|update|delete)\s*\(/.test(src) ||
      /rpc\(\s*["'`][a-z_]*area_pick[a-z_]*["'`]/.test(src);
    if (writes) direct.push(rel);
    if (/\bwriteAreaPickRows\(/.test(src) && rel !== "lib/areaPicksWrite.ts") {
      callers.push(rel);
      assert.match(src, /mirrorCoverageFromPicks\(/, `${rel} writes tenant_area_picks without the coverage mirror`);
    }
  }
  assert.deepEqual(direct, ["lib/areaPicksWrite.ts"], "only areaPicksWrite.ts writes the table; route new writers through it");
  assert.deepEqual(callers, ["lib/areaPicks.server.ts"], "a new writer must call mirrorCoverageFromPicks and be listed here");
  const server = readFileSync(join(root, "lib/areaPicks.server.ts"), "utf8");
  const save = server.slice(server.indexOf("export async function saveAreaPicks"), server.indexOf("export async function mirrorCoverageFromPicks"));
  const afterWrite = save.slice(save.indexOf("writeAreaPickRows("));
  assert.doesNotMatch(afterWrite, /return \{ ok: true \}/, "saveAreaPicks returns ok without mirroring");
  assert.equal((afterWrite.match(/mirrorCoverageFromPicks\(/g) || []).length, 1);
  assert.match(server, /areaPicksToCoverageAreas\([\s\S]{0,400}priorCoverage[\s\S]{0,200}priorPicks/, "mirror gets the prior coverage and picks (lossless)");
  // D4: a failed write returns before the mirror, so a lost insert never reaches coverage_areas.
  assert.ok(save.indexOf("if (!written.ok) return") > 0 && save.indexOf("if (!written.ok) return") < save.indexOf("mirrorCoverageFromPicks("));
  // D2: fail closed returns before any tenants update.
  const mirrorFn = server.slice(server.indexOf("export async function mirrorCoverageFromPicks"));
  assert.ok(mirrorFn.indexOf("if (mirror.failClosed)") > 0 && mirrorFn.indexOf("if (mirror.failClosed)") < mirrorFn.indexOf(".update("));
  assert.match(mirrorFn, /unmapped_all/);
  assert.match(mirrorFn, /movedFrom,\s*homeCounty: businessHomeCounty/);
});

test("every Desk save path reaches saveAreaPicks (settings page, onboarding step, confirm nudge)", () => {
  const read = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");
  assert.match(read("app/(desk)/settings/areas/actions.ts"), /saveAreaPicks\(/);
  assert.match(read("app/onboarding/OnboardingAreasPanel.tsx"), /saveAction=\{saveAreaPicksAction\}/);
  assert.match(read("lib/areaConfirmCheck.server.ts"), /\/settings\/areas\?view=check/);
});
