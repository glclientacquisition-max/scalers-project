/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/catalogValidation.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import {
  catalogSaveError,
  omitUnsavedPrices,
  priceIssueSummary,
  priceTextError,
} from "../dashboard/src/lib/catalogValidation.ts";

it("rejects -50 and abc, accepts real prices", () => {
  assert.ok(priceTextError("-50"));
  assert.ok(priceTextError("abc"));
  for (const ok of [
    "150",
    "KSh 1,200",
    "from 300",
    "200-400",
    "ask",
    "",
    "price depends on size",
    "depends on size",
    "KES 8,000 a month",
    "KSh 60 per sq ft",
    "quote after visit",
  ]) {
    assert.equal(priceTextError(ok), null, ok);
  }
});
it("names the bad row and catches duplicates", () => {
  assert.match(String(catalogSaveError({ products: [{ name: "Pen", price: "-50" }] })), /^Pen:/);
  assert.match(String(catalogSaveError({ services: [{ name: "Binding", price_range: "100" }, { name: "binding", price_range: "100" }] })), /twice/);
  assert.equal(catalogSaveError({ products: [{ name: "Pen", price: "50" }] }), null);
  assert.equal(
    catalogSaveError({ services: [{ name: "Deep clean", price_range: "price depends on size" }] }),
    null
  );
});
it("keeps good rows when one price cannot be saved", () => {
  const split = omitUnsavedPrices(
    [
      { name: "Deep clean", price_range: "price depends on size" },
      { name: "Nope", price_range: "abc" },
      { name: "Office cleaning", price_range: "KES 8,000 a month" },
    ],
    "price_range"
  );
  assert.deepEqual(
    split.rows.map((row) => row.name),
    ["Deep clean", "Office cleaning"]
  );
  assert.equal(split.issues.length, 1);
  assert.match(split.issues[0].message, /^Nope:/);
  assert.match(priceIssueSummary(split.issues, true), /The rest was saved\.$/);
  assert.doesNotMatch(priceIssueSummary(split.issues, false), /The rest was saved/);
});
it("keeps the stored price when an edit is not a price", () => {
  const split = omitUnsavedPrices(
    [{ name: "Deep clean", price_range: "abc" }],
    "price_range",
    [{ name: "Deep clean", price_range: "ask" }]
  );
  assert.equal(split.rows[0]?.price_range, "ask");
  assert.equal(split.issues.length, 1);
});
