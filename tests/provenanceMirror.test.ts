// Desk twin parity: dashboard/src/lib/provenance.ts speechFactText (and factPrice.ts, kbCaller.ts) against Voice
// src/conversation/provenance.js on shared fixtures, legacy and KB v2 mode (Brain #1000: the fact sheet reads
// through src/knowledge/kb/source.js; notes are empty when the KB is live). One predicate, isKbLive =
// BRAIN_KB_GATE on AND readiness passed for the live snapshot; BRAIN_CONFIRMED_COVERAGE passed in, default off.
// Run: node --experimental-strip-types --no-warnings --import ./tests/registerTs.mjs --test tests/provenanceMirror.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { catalogueMode, factPolicyMap as deskPolicyMap, indexFieldMeta as deskIndex, speechFactText as deskFacts, withConfirmedCoverage } from "../dashboard/src/lib/provenance.ts";
import * as DP from "../dashboard/src/lib/factPrice.ts";
import { isKbLive, kbCallerRow, kbFactProfile, kbOpenerLine, offeredKbItems } from "../dashboard/src/lib/kbCaller.ts";
import { mirrorLegacy } from "../dashboard/src/lib/kbCore.ts";
import { kbCatalogueView, withKbCatalogue } from "../dashboard/src/lib/kbRead.ts";
import type { KbCategory, KbItem } from "../dashboard/src/lib/kbCore.ts";

const require = createRequire(import.meta.url);
delete process.env.FACT_HASH_MODE;
delete process.env.BRAIN_CONFIRMED_COVERAGE;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
const PV = require("../src/conversation/provenance");
const VP = require("../src/conversation/factPrice");
const C = require("../src/knowledge/kb/compile");
const L = require("../src/knowledge/kb/live");
const S = require("../src/knowledge/kb/source");
const { tenantProfileFromRow } = require("../src/tenantProfile");
const FR = require("./fixtures/dndSimTenant.json");
const GOLD = require("./fixtures/kbLegacyGolden.json");

const NOW = new Date("2026-10-28T10:00:00+03:00");
const legacyProfile = () => {
  const inner = FR.picks.picks;
  const areaPicksRows = inner.picks.map((row: Record<string, unknown>) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version }));
  return { ...tenantProfileFromRow(FR.row, { fieldMeta: PV.indexFieldMeta(FR.meta), areaPicksRows }), id: FR.row.id };
};

// Same shape as tests/kbSource.test.js: offered, paused, not offered, hidden, products, a range, quote and site visit.
const CATS: KbCategory[] = [
  { id: "home", name_en: "Home cleaning", name_sw: null, name_sw_state: "none", sort: 0 },
  { id: "fabric", name_en: "Fabric cleaning", name_sw: null, name_sw_state: "none", sort: 1 },
  { id: "office", name_en: "Office cleaning", name_sw: null, name_sw_state: "none", sort: 2 },
  { id: "shop", name_en: "Cleaning supplies", name_sw: null, name_sw_state: "none", sort: 3 },
];
const it_ = (o: Partial<KbItem> & { id: string; name_en: string }): KbItem => ({
  kind: "service", name_sw: null, name_sw_state: "none", name_sw_suggested: null, aliases: [], category_id: "home", description_en: null,
  unit: null, price_mode: "fixed", price_amount: 3000, price_min: null, price_max: null, in_stock: null, popular: false, delivery_fee_kes: null,
  needs_visit: false, holdable: false, excludes_en: null, status_note: null, status: "active", sort: 0, source: "owner", legacy_ref: null, row_version: 1, ...o,
});
const ITEMS: KbItem[] = [
  it_({ id: "dc", name_en: "Deep clean", price_amount: 6000, sort: 0, description_en: "Inside cabinets and behind appliances" }),
  it_({ id: "pc", name_en: "Post-construction clean", price_amount: 6000, sort: 1 }),
  it_({ id: "mould", name_en: "Mould treatment", price_mode: "site_visit", price_amount: null, sort: 2 }),
  it_({ id: "uph", name_en: "Upholstery repair", category_id: "fabric", price_mode: "quote", price_amount: null, sort: 3 }),
  it_({ id: "mat", name_en: "Mattress cleaning", category_id: "fabric", price_amount: 2500, sort: 4 }),
  it_({ id: "sofa", name_en: "Sofa cleaning", category_id: "fabric", status: "paused", status_note: "Back next week", sort: 5 }),
  it_({ id: "carpet", name_en: "Carpet cleaning", category_id: "fabric", status: "not_offered", sort: 6 }),
  it_({ id: "pw", name_en: "Pressure washing", status: "hidden", sort: 7 }),
  it_({ id: "off", name_en: "Office deep clean", category_id: "office", price_mode: "range", price_amount: null, price_min: 4000, price_max: 9000, sort: 8 }),
  it_({ id: "bags", kind: "product", name_en: "Vacuum bags", category_id: "shop", price_amount: 500, holdable: true, sort: 9 }),
  it_({ id: "mop", kind: "product", name_en: "Spin mop", category_id: "shop", price_amount: 800, sort: 10 }),
];
const OFF_NAMES = /Sofa cleaning|Carpet cleaning|Pressure washing/;
const STALE = "Services:\nDeep clean, sofa cleaning, carpet cleaning (legacy text)";
const ROW = { id: "prov-mirror-1", business_name: "Sparkle Test Cleaners", services_offered: STALE, vertical: "home_services" };
const compiled = C.compileKb({ items: ITEMS, categories: CATS, business: "prov-mirror", now: NOW });
const voiceKbProfile = () => {
  const p = tenantProfileFromRow({ ...ROW }, { areaPicksRows: [] });
  L.attach(p, { version: 3, readyVersion: 3, brainTarget: "v2", doc: compiled.doc, bytes: null, loadMs: 1 }, { env: { BRAIN_KB_GATE: "on" } });
  return p;
};

test("legacy: Desk fact sheet equals Voice, byte for byte, and the pre-KB golden", () => {
  const voice = PV.speechFactText(legacyProfile());
  assert.equal(deskFacts(legacyProfile()), voice);
  assert.equal(voice, GOLD.speechFactText);
  assert.equal(catalogueMode(legacyProfile()), "legacy");
  assert.equal(JSON.parse(voice).notes.length > 0, true, "legacy keeps the old notes");
});

test("legacy: Desk indexFieldMeta matches Voice on the fixture meta", () => {
  assert.deepEqual(deskIndex(FR.meta), PV.indexFieldMeta(FR.meta));
});

test("KB: Desk reads a Voice-attached profile exactly like Voice (offered only, notes empty)", () => {
  const voice = PV.speechFactText(voiceKbProfile());
  assert.equal(S.catalogueSource(voiceKbProfile()).mode, "kb");
  assert.equal(catalogueMode(voiceKbProfile()), "kb");
  assert.equal(deskFacts(voiceKbProfile()), voice);
  const f = JSON.parse(voice);
  assert.equal(f.notes, "");
  assert.ok(!OFF_NAMES.test(voice), "off item in the fact sheet");
  assert.ok(!/legacy text/.test(voice));
});

// The stored row a KB business has today: the Desk mirror (all non-hidden rows) + the derived services text.
const STORED = { ...ROW, ...mirrorLegacy(ITEMS, CATS, { services_catalog: [], product_catalog: [] }) };
const voiceAttached = ({ gate, ready }: { gate: boolean; ready: boolean }) => {
  const p = tenantProfileFromRow({ ...STORED }, { areaPicksRows: [] });
  L.attach(p, { version: 3, readyVersion: ready ? 3 : 2, brainTarget: "v2", doc: compiled.doc, bytes: null, loadMs: 1 }, { env: { BRAIN_KB_GATE: gate ? "on" : "off" } });
  return p;
};
const deskProfileFor = ({ gate, ready }: { gate: boolean; ready: boolean }) => {
  const live = isKbLive({ gate, liveVersion: 3, brainTarget: "v2", readinessPassed: ready, snapshot: true });
  return { live, profile: kbFactProfile(tenantProfileFromRow(kbCallerRow({ ...STORED }, ITEMS, CATS, live), { areaPicksRows: [] }), live) };
};

for (const c of [
  { gate: false, ready: false, want: "legacy" },
  { gate: false, ready: true, want: "legacy" },
  { gate: true, ready: false, want: "legacy" },
  { gate: true, ready: true, want: "kb" },
] as const) {
  test(`gate ${c.gate ? "on" : "off"}, readiness ${c.ready ? "passed" : "not passed"}: ${c.want}, same fact sheet as Voice`, () => {
    const vp = voiceAttached(c);
    assert.equal(S.catalogueSource(vp).mode, c.want);
    const { live, profile } = deskProfileFor(c);
    assert.equal(live, c.want === "kb");
    assert.equal(catalogueMode(profile), c.want);
    const voice = JSON.parse(PV.speechFactText(vp));
    const desk = JSON.parse(deskFacts(profile));
    assert.deepEqual(desk.services, voice.services);
    assert.deepEqual(desk.products, voice.products);
    assert.equal(desk.notes, voice.notes);
    if (c.want === "legacy") {
      assert.equal(deskFacts(profile), PV.speechFactText(vp), "legacy is byte for byte");
      assert.match(desk.notes, /legacy text/);
      assert.match(JSON.stringify(desk.services), /Sofa cleaning/, "legacy keeps the stored rows");
    } else {
      assert.equal(desk.notes, "");
      assert.ok(!OFF_NAMES.test(JSON.stringify(desk)), "off item in the KB fact sheet");
      // Voice code on the Desk-projected row (the What it will say page path) reads the same.
      const onRow = JSON.parse(PV.speechFactText(tenantProfileFromRow(kbCallerRow({ ...STORED }, ITEMS, CATS, true), { areaPicksRows: [] })));
      assert.deepEqual(onRow.services, voice.services);
      assert.equal(onRow.notes, "");
    }
  });
}

test("isKbLive: gate, live version, v2 target, passed readiness and a snapshot are all required; default off", () => {
  const ok = { gate: true, liveVersion: 3, brainTarget: "v2", readinessPassed: true, snapshot: true };
  assert.equal(isKbLive(ok), true);
  assert.equal(isKbLive({ ...ok, brainTarget: null }), true, "brain_target defaults to v2");
  assert.equal(isKbLive(null), false);
  assert.equal(isKbLive({}), false);
  assert.equal(isKbLive({ ...ok, gate: undefined }), false);
  assert.equal(isKbLive({ ...ok, gate: false }), false);
  assert.equal(isKbLive({ ...ok, liveVersion: null }), false);
  assert.equal(isKbLive({ ...ok, brainTarget: "v1" }), false);
  assert.equal(isKbLive({ ...ok, readinessPassed: false }), false);
  assert.equal(isKbLive({ ...ok, snapshot: false }), false);
});

test("KB: stale stored notes never reach the Desk fact sheet", () => {
  const stale = tenantProfileFromRow({ ...ROW }, { areaPicksRows: [] });
  assert.match(JSON.parse(deskFacts(stale)).notes, /legacy text/, "legacy reads the stored text");
  assert.equal(JSON.parse(deskFacts(kbFactProfile(stale, true))).notes, "");
});

test("KB: greeting offering line matches source.js openerLine (groups, never items)", () => {
  assert.equal(kbOpenerLine(ITEMS, CATS), S.catalogueSource(voiceKbProfile()).openerLine("en"));
  assert.equal(kbOpenerLine(ITEMS, CATS), "We help with home cleaning, fabric cleaning and office cleaning.");
  const one = ITEMS.filter((i) => i.category_id === "home");
  assert.equal(kbOpenerLine(one, CATS), "", "one group: no names");
  const view = kbCatalogueView(ITEMS, CATS, { services_offered: STALE }, { kbLive: true });
  assert.equal(view.offering_line, kbOpenerLine(ITEMS, CATS));
  const t = withKbCatalogue({ id: "x", services_offered: STALE } as { id: string; services_offered: string; kb_offering_line?: string | null }, view);
  assert.equal(t.kb_offering_line, view.offering_line);
});

test("not live: rows and views stay legacy", () => {
  const row = { ...ROW, services_catalog: [], product_catalog: [] };
  assert.equal(kbCallerRow(row, ITEMS, CATS, false), row);
  assert.equal(kbCallerRow(row, null, CATS, true), row);
  assert.equal(kbCatalogueView(ITEMS, CATS, {}).offering_line, null, "kbLive defaults off");
  assert.equal(withKbCatalogue({ id: "x" } as { id: string; kb_offering_line?: string | null }, kbCatalogueView(ITEMS, CATS, {})).kb_offering_line, undefined);
  assert.equal(JSON.parse(deskFacts(kbFactProfile(tenantProfileFromRow({ ...ROW }, { areaPicksRows: [] }), false))).notes.length > 0, true);
  assert.deepEqual(offeredKbItems(ITEMS).map((i) => i.id), ["dc", "pc", "mould", "uph", "mat", "off", "bags", "mop"]);
});

test("BRAIN_CONFIRMED_COVERAGE: off by default, on mirrors Voice (owner-confirmed list only)", () => {
  const policies = FR.row.business_policies;
  const meta = PV.indexFieldMeta(FR.meta);
  const noCoverageRow = PV.indexFieldMeta((FR.meta as { field_path?: string }[]).filter((r) => r.field_path !== "policies.coverage_areas"));
  const ownerRow = PV.indexFieldMeta([...(FR.meta as { field_path?: string }[]).filter((r) => r.field_path !== "policies.coverage_areas"), { field_path: "policies.coverage_areas", source: "owner", confirmed_at: "2026-10-20T10:00:00Z" }]);
  const seedRow = PV.indexFieldMeta([...(FR.meta as { field_path?: string }[]).filter((r) => r.field_path !== "policies.coverage_areas"), { field_path: "policies.coverage_areas", source: "seed" }]);
  const cases: [string, unknown, unknown][] = [
    ["fixture", policies, meta],
    ["no coverage row", policies, noCoverageRow],
    ["owner row", policies, ownerRow],
    ["seed row", policies, seedRow],
    ["empty list, owner row", { ...policies, coverage_areas: [] }, ownerRow],
    ["empty list, no row", { ...policies, coverage_areas: [] }, noCoverageRow],
    ["no fieldMeta", policies, null],
  ];
  const prev = process.env.BRAIN_CONFIRMED_COVERAGE;
  try {
    for (const [name, pol, fm] of cases) {
      delete process.env.BRAIN_CONFIRMED_COVERAGE;
      assert.deepEqual(deskPolicyMap(pol, fm), PV.factPolicyMap(pol, fm), `off: ${name}`);
      assert.deepEqual(deskPolicyMap(pol, withConfirmedCoverage(fm, false)), PV.factPolicyMap(pol, fm), `off explicit: ${name}`);
      process.env.BRAIN_CONFIRMED_COVERAGE = "on";
      assert.deepEqual(deskPolicyMap(pol, withConfirmedCoverage(fm, true)), PV.factPolicyMap(pol, fm), `on: ${name}`);
    }
    // the rule changes something on these fixtures (else the parity above proves little)
    delete process.env.BRAIN_CONFIRMED_COVERAGE;
    const off = deskPolicyMap(policies, noCoverageRow);
    const on = deskPolicyMap(policies, withConfirmedCoverage(noCoverageRow, true));
    assert.ok(Array.isArray(off.policies.coverage_areas));
    assert.equal(on.policies.coverage_areas, undefined);
    assert.ok(on.unknown.includes("Areas we serve"));
    assert.deepEqual(deskPolicyMap(policies, withConfirmedCoverage(ownerRow, true)).policies.coverage_areas, off.policies.coverage_areas);
    // carried from indexFieldMeta like hashMode / seedFilter, and through the fact sheet
    assert.equal(deskIndex(FR.meta, { confirmedCoverage: true })?.confirmedCoverage, true);
    assert.equal(deskIndex(null, { confirmedCoverage: true })?.confirmedCoverage, true);
    assert.equal(deskIndex(FR.meta)?.confirmedCoverage, undefined);
    process.env.BRAIN_CONFIRMED_COVERAGE = "on";
    const vp = { ...legacyProfile(), fieldMeta: noCoverageRow };
    assert.equal(deskFacts({ ...legacyProfile(), fieldMeta: withConfirmedCoverage(noCoverageRow, true) }), PV.speechFactText(vp));
  } finally {
    if (prev === undefined) delete process.env.BRAIN_CONFIRMED_COVERAGE;
    else process.env.BRAIN_CONFIRMED_COVERAGE = prev;
  }
});

test("factPrice twin: same parse and display as Voice", () => {
  const rows = [
    { price: "KSh 2,500" }, { price_range: "1,500-4,000 per carpet" }, { price_range: "KSh 700 per seat" }, { price: "from 3k" },
    { price: "ask" }, { price: "Call us for a quote" }, { price: "" }, { pricing_mode: "range", price: "4000", price_max: "9000" },
    { pricing_mode: "fixed", price: "6000" }, { pricing_mode: "from", price: "1200" }, { pricing_mode: "quote" }, { price: "min 2 hours 1500" },
    { price: "Kuanzia 800" }, { price: "2,000 to 3,000" }, { price: "1.5m" }, { price: "abc" }, { priceRange: "Ksh 150 per window" },
  ];
  for (const r of rows) {
    const v = VP.normalisePrice(r);
    assert.deepEqual(DP.normalisePrice(r), v, JSON.stringify(r));
    for (const lang of ["en", "sw"]) assert.equal(DP.formatPriceDisplay(v, lang, DP.legacyPriceText(r)), VP.formatPriceDisplay(v, lang, VP.legacyPriceText(r)), JSON.stringify(r));
  }
});

test("pure Desk twins never read env; the server reads BRAIN_KB_GATE and BRAIN_CONFIRMED_COVERAGE and passes them in", async () => {
  const fs = await import("node:fs");
  const read = (p: string) => fs.readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");
  for (const f of ["lib/provenance.ts", "lib/kbCaller.ts", "lib/factPrice.ts", "lib/kbRead.ts"]) assert.ok(!/process\.env\.[A-Z_]/.test(read(f)), f);
  const server = read("lib/kbCaller.server.ts");
  assert.match(server, /process\.env\.BRAIN_KB_GATE/);
  assert.match(server, /from\("kb_readiness"\)\.select\("id"\)\.eq\("tenant_id", tenantId\)\.eq\("snapshot_version", live\)\.eq\("passed", true\)/);
  assert.match(server, /createWorkspaceDataClient/, "readiness is read with the member's session");
  assert.match(read("lib/tenantFieldProvenance.ts"), /indexFieldMeta\(rows, \{ hashMode: factHashModeFromEnv\(\), seedFilter, confirmedCoverage \}\)/);
});
