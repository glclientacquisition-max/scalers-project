// Desk twin parity: dashboard/src/lib/provenance.ts speechFactText (and factPrice.ts, kbCaller.ts) against Voice
// src/conversation/provenance.js on shared fixtures, legacy and KB v2 mode (Brain #1000: the fact sheet reads
// through src/knowledge/kb/source.js; notes are empty for a KB business).
// Run: node --experimental-strip-types --no-warnings --import ./tests/registerTs.mjs --test tests/provenanceMirror.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { catalogueMode, speechFactText as deskFacts, indexFieldMeta as deskIndex } from "../dashboard/src/lib/provenance.ts";
import * as DP from "../dashboard/src/lib/factPrice.ts";
import { isKbCallerBusiness, kbCallerRow, kbFactProfile, kbOpenerLine, offeredKbItems } from "../dashboard/src/lib/kbCaller.ts";
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

test("KB: the Desk projection from kb_items gives Voice's fact sheet (names, prices, notes)", () => {
  const voice = JSON.parse(PV.speechFactText(voiceKbProfile()));
  const deskRow = kbCallerRow({ ...ROW, services_catalog: [], product_catalog: [] }, ITEMS, CATS);
  assert.equal(deskRow.services_offered, null);
  const deskProfile = kbFactProfile(tenantProfileFromRow(deskRow, { areaPicksRows: [] }), true);
  const desk = JSON.parse(deskFacts(deskProfile));
  assert.deepEqual(desk.services, voice.services);
  assert.deepEqual(desk.products, voice.products);
  assert.equal(desk.notes, "");
  // Voice code on the Desk-projected row (the What it will say page path) is legacy mode yet reads the same.
  assert.deepEqual(JSON.parse(PV.speechFactText(tenantProfileFromRow(deskRow, { areaPicksRows: [] }))).services, voice.services);
  assert.equal(JSON.parse(PV.speechFactText(tenantProfileFromRow(deskRow, { areaPicksRows: [] }))).notes, "");
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
  const view = kbCatalogueView(ITEMS, CATS, { services_offered: STALE });
  assert.equal(view.offering_line, kbOpenerLine(ITEMS, CATS));
  const t = withKbCatalogue({ id: "x", services_offered: STALE } as { id: string; services_offered: string; kb_offering_line?: string | null }, view);
  assert.equal(t.kb_offering_line, view.offering_line);
});

test("not a KB business (no offered items): rows and views stay legacy", () => {
  const offOnly = ITEMS.map((i) => ({ ...i, status: "paused" as const }));
  assert.equal(isKbCallerBusiness(offOnly), false);
  assert.equal(isKbCallerBusiness(null), false);
  const row = { ...ROW, services_catalog: [], product_catalog: [] };
  assert.equal(kbCallerRow(row, offOnly, CATS), row);
  assert.equal(kbCallerRow(row, null, CATS), row);
  assert.equal(kbCatalogueView(offOnly, CATS, {}).offering_line, null);
  assert.equal(withKbCatalogue({ id: "x" } as { id: string; kb_offering_line?: string | null }, kbCatalogueView(offOnly, CATS, {})).kb_offering_line, undefined);
  assert.deepEqual(offeredKbItems(ITEMS).map((i) => i.id), ["dc", "pc", "mould", "uph", "mat", "off", "bags", "mop"]);
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
