import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCatalogueLegacyPrice,
  numericPriceInputError,
  parseCataloguePriceText,
  validateCatalogPriceFields,
} from "../dashboard/src/lib/catalogPriceKind.ts";
import { hashFactValue, priceFactValue } from "../dashboard/src/lib/factHash.ts";

test("parseCataloguePriceText fixtures", () => {
  assert.deepEqual(parseCataloguePriceText("Ask"), { kind: "quote", min: null, max: null });
  assert.deepEqual(parseCataloguePriceText("2,000"), { kind: "fixed", min: 2000, max: null });
  assert.deepEqual(parseCataloguePriceText("from 1500"), { kind: "from", min: 1500, max: null });
  assert.deepEqual(parseCataloguePriceText("500-800"), { kind: "range", min: 500, max: 800 });
  assert.deepEqual(parseCataloguePriceText(""), { kind: "quote", min: null, max: null });
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

test("priceFactValue includes price_kind and amounts when set", () => {
  const row = {
    price_range: "KSh 500–800",
    price_kind: "range",
    price_min: 500,
    price_max: 800,
    pricing_mode: "range",
  };
  assert.deepEqual(priceFactValue(row, "service"), {
    price: "KSh 500–800",
    mode: "range",
    price_kind: "range",
    price_min: 500,
    price_max: 800,
  });
  const quote = { price_range: "", price_kind: "quote", pricing_mode: "quote" };
  assert.deepEqual(priceFactValue(quote, "service"), { mode: "quote", price_kind: "quote" });
  const before = hashFactValue(priceFactValue(row, "service"));
  const after = hashFactValue(
    priceFactValue({ ...row, price_min: 600, price_max: 800 }, "service")
  );
  assert.notEqual(before, after);
});
