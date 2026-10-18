import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  confirmPriceFields,
  parsePriceText,
  priceTextCovers,
  spokenPrice,
  type StructuredPrice,
} from "../dashboard/src/lib/structuredData.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

// Done and Dusted, as stored before anyone tapped Yes (Oct 12 staging).
const DND = [
  "Ksh 800-1200",
  "KSh 3,000 flat",
  "KSh 4,500 flat",
  "KSh 6,000 flat",
  "KSh 500 per hour (min 3 hours)",
  "Base + KSh 3,000 to 6,000",
  "KSh 5,000 flat (2-bed unit)",
  "KSh 40 per sq ft",
  "KSh 15,000 per visit",
  "KSh 25,000 per visit",
  "Custom quote (KSh 35-150 per sq m per month)",
  "KSh 800 per seat",
  "KSh 2,200 per room",
  "KSh 200 per window",
  "KSh 1,000 per unit",
  "KSh 1,200 per unit",
];

const NEW_LINES = [
  "KSh 40 per sq ft",
  "KSh 500 per job",
  "KSh 15,000 per visit",
  "KSh 1,200 per day",
  "KSh 2,000 a month",
  "KSh 800 per seat",
  "KSh 1,500 per sofa",
  "KSh 800 per trip",
  "KSh 300 /kg",
  "KSh 1,000 - 2,000 per visit",
  "From KSh 2,500 per day",
  "Ask",
  "depends on size",
];

/** What the old backfill stored: amounts, unit always null, original text kept. */
function asBackfill(text: string): StructuredPrice {
  const p = parsePriceText(text);
  return {
    ...p,
    unit: null,
    unit_label: null,
    in_stock: null,
    source: "parsed",
    confirmed: false,
    parsed_from: text,
  };
}

function yes(text: string, pricing: StructuredPrice = asBackfill(text)) {
  return confirmPriceFields({
    storedText: text,
    storedPricing: pricing,
    incoming: { ...pricing, source: "owner", confirmed: true },
  });
}

test("new price lines keep the unit the owner wrote", () => {
  assert.equal(parsePriceText("KSh 40 per sq ft").unit, null);
  assert.equal(parsePriceText("KSh 40 per sq ft").unit_label, "sq ft");
  assert.equal(parsePriceText("KSh 40 per sq m").unit, "sqm");
  assert.equal(parsePriceText("KSh 500 per job").unit, "job");
  assert.equal(parsePriceText("KSh 15,000 per visit").unit, "visit");
  assert.equal(parsePriceText("KSh 800 per seat").unit, "seat");
  assert.equal(parsePriceText("KSh 300 /kg").unit, "kg");
  assert.equal(parsePriceText("KSh 1,200 per day").unit_label, "day");
  assert.equal(parsePriceText("KSh 2,000 a month").unit_label, "month");
  assert.equal(parsePriceText("KSh 1,500 per sofa").unit_label, "sofa");
  assert.equal(parsePriceText("KSh 800 per trip").unit_label, "trip");
  assert.equal(parsePriceText("KSh 200 per window").unit_label, "window");
  assert.equal(parsePriceText("KSh 1,000 per unit").unit, null);
  assert.equal(parsePriceText("KSh 1,000 per unit").unit_label, "unit");
  const range = parsePriceText("KSh 1,000 - 2,000 per visit");
  assert.deepEqual([range.mode, range.min_ksh, range.max_ksh, range.unit], ["range", 1000, 2000, "visit"]);
  const from = parsePriceText("From KSh 2,500 per day");
  assert.equal(from.mode, "from");
  assert.equal(from.amount_ksh, 2500);
  assert.equal(parsePriceText("Ask").mode, "ask");
  assert.equal(parsePriceText("depends on size").mode, "ask");
  // A duration is not a price floor.
  const minHours = parsePriceText("KSh 500 per hour (min 3 hours)");
  assert.equal(minHours.mode, "fixed");
  assert.equal(minHours.unit, "hour");
});

test("Yes on a backfilled price does not drop the owner's unit or extra words", () => {
  for (const text of [...DND, ...NEW_LINES]) {
    const saved = yes(text);
    assert.equal(priceTextCovers(saved.text, text), true, text);
    assert.equal(saved.pricing.confirmed, true, text);
    assert.equal(saved.pricing.parsed_from, text, text);
  }
  assert.match(yes("KSh 40 per sq ft").text, /sq ft/);
  assert.match(yes("KSh 300 /kg").text, /kg/);
  assert.match(yes("KSh 15,000 per visit").text, /visit/);
  assert.match(yes("KSh 500 per job").text, /job/);
  assert.match(yes("KSh 1,200 per day").text, /day/);
  assert.match(yes("KSh 2,000 a month").text, /month/);
  assert.match(yes("KSh 1,500 per sofa").text, /sofa/);
  assert.match(yes("KSh 800 per trip").text, /trip/);
  assert.equal(yes("depends on size").text, "depends on size");
  assert.equal(yes("KSh 500 per hour (min 3 hours)").text, "KSh 500 per hour (min 3 hours)");
  assert.match(yes("Custom quote (KSh 35-150 per sq m per month)").text, /per month/);
  assert.match(yes("Base + KSh 3,000 to 6,000").text, /Base/);
});

test("the card shows the same line Yes will save", () => {
  for (const text of ["KSh 40 per sq ft", "KSh 300 /kg", "depends on size", "KSh 15,000 per visit"]) {
    const pricing = asBackfill(text);
    const saved = yes(text, pricing);
    assert.equal(spokenPrice(pricing, text), saved.text, text);
  }
});

test("changing the amount keeps the unit; picking a unit replaces the old phrase", () => {
  const stored = asBackfill("KSh 40 per sq ft");
  const raised = confirmPriceFields({
    storedText: "KSh 40 per sq ft",
    storedPricing: stored,
    incoming: { ...stored, amount_ksh: 55, source: "owner", confirmed: true },
  });
  assert.match(raised.text, /55/);
  assert.match(raised.text, /sq ft/);
  assert.doesNotMatch(raised.text, /\b40\b/);

  const picked = confirmPriceFields({
    storedText: "KSh 40 per sq ft",
    storedPricing: stored,
    incoming: { ...stored, unit: "visit", source: "owner", confirmed: true },
  });
  assert.match(picked.text, /visit/);
  assert.doesNotMatch(picked.text, /sq ft/);
});

test("a shortened line is repaired from parsed_from when the amount is unchanged", () => {
  const stored = asBackfill("KSh 40 per sq ft");
  const saved = confirmPriceFields({
    storedText: "KSh 40",
    storedPricing: stored,
    incoming: { ...stored, source: "owner", confirmed: true },
  });
  assert.match(saved.text, /sq ft/);
});

test("wiring: Yes uses confirmPriceFields; the card shows spokenPrice", () => {
  const action = read("dashboard/src/app/(desk)/settings/structuredActions.ts");
  const price = action.slice(action.indexOf("export async function confirmPriceAction"), action.indexOf("export async function saveBusinessCategoryAction"));
  assert.match(price, /confirmPriceFields\(/);
  assert.doesNotMatch(price, /parsed_from: label/);
  assert.doesNotMatch(price, /const label = priceLabel/);
  assert.match(read("dashboard/src/components/structured/PriceConfirmCards.tsx"), /spokenPrice\(/);
});

test("forward migration repairs units and does not edit the applied backfill", () => {
  const applied = read("supabase/migrations/20261011200000_structured_data_foundation.sql");
  const repair = read("supabase/migrations/20261018200000_price_unit_preserve.sql");
  assert.match(applied, /'unit', null/);
  assert.match(repair, /create or replace function public\.parse_price_ksh/);
  assert.match(repair, /unit_label/);
  assert.match(repair, /staging first/i);
  assert.match(repair, /backup before prod/i);
  assert.match(repair, /value_hash/);
  assert.doesNotMatch(repair, /delete from public\.tenants/i);
  const filler = read("dashboard/src/lib/structuredData.ts").match(/const PRICE_FILLER = \[([^\]]+)\]/);
  assert.ok(filler);
  for (const word of filler[1].match(/[a-z]+/g) ?? []) {
    assert.ok(repair.includes(`'${word}'`), word);
  }
});
