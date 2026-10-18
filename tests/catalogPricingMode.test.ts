import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCatalogueLegacyPrice,
  numericPriceInputError,
  parseCataloguePriceText,
  validateCatalogPriceFields,
  applyCatalogPriceFields,
} from "../dashboard/src/lib/catalogPricingMode.ts";

test("parseCataloguePriceText fixtures", () => {
  assert.deepEqual(parseCataloguePriceText("Ask"), { kind: "quote", price: null, priceMax: null });
  assert.deepEqual(parseCataloguePriceText("2,000"), { kind: "fixed", price: 2000, priceMax: null });
  assert.deepEqual(parseCataloguePriceText("from 1500"), { kind: "from", price: 1500, priceMax: null });
  assert.deepEqual(parseCataloguePriceText("500-800"), { kind: "range", price: 500, priceMax: 800 });
  assert.deepEqual(parseCataloguePriceText(""), { kind: "quote", price: null, priceMax: null });
});

test("formatCatalogueLegacyPrice", () => {
  assert.equal(formatCatalogueLegacyPrice("fixed", 2000, null), "KSh 2,000");
  assert.equal(formatCatalogueLegacyPrice("from", 1500, null), "From KSh 1,500");
  assert.equal(formatCatalogueLegacyPrice("range", 500, 800), "KSh 500–800");
  assert.equal(formatCatalogueLegacyPrice("quote", null, null), "");
});

test("validateCatalogPriceFields rejects non-numeric input in Fixed/From/Range", () => {
  assert.match(validateCatalogPriceFields("fixed", "abc", "").min ?? "", /numbers only/i);
  assert.match(validateCatalogPriceFields("from", "1.5k", "").min ?? "", /numbers only/i);
  assert.match(validateCatalogPriceFields("range", "500", "four").max ?? "", /numbers only/i);
  assert.deepEqual(validateCatalogPriceFields("quote", "", ""), {});
  assert.deepEqual(validateCatalogPriceFields("fixed", "2000", ""), {});
});

test("numericPriceInputError", () => {
  assert.match(numericPriceInputError("12abc") ?? "", /numbers only/i);
});

test("applyCatalogPriceFields sets pricing_mode, price, price_max", () => {
  const row = applyCatalogPriceFields(
    { name: "Clean", price_range: "" },
    "range",
    "500",
    "800",
    "price_range"
  );
  assert.equal(row.pricing_mode, "range");
  assert.equal(row.price, "500");
  assert.equal(row.price_max, 800);
  assert.equal(row.price_range, "KSh 500–800");
});
