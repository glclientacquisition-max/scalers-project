import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogPriceFieldErrors,
  emptyCatalogPriceTouch,
  transitionCatalogPriceKind,
} from "../dashboard/src/lib/catalogPriceEditorState.ts";

test("transitionCatalogPriceKind preserves amounts across Quote and Fixed", () => {
  const fixed = { kind: "fixed" as const, minInput: "2000", maxInput: "" };
  const quote = transitionCatalogPriceKind(fixed, "quote");
  assert.equal(quote.minInput, "2000");
  const back = transitionCatalogPriceKind(quote, "fixed");
  assert.equal(back.minInput, "2000");
});

test("transitionCatalogPriceKind keeps lowest when Fixed or From becomes Range", () => {
  const fixed = { kind: "fixed" as const, minInput: "2000", maxInput: "" };
  const range = transitionCatalogPriceKind(fixed, "range");
  assert.equal(range.kind, "range");
  assert.equal(range.minInput, "2000");
  assert.equal(range.maxInput, "");

  const from = { kind: "from" as const, minInput: "1500", maxInput: "" };
  const rangeFrom = transitionCatalogPriceKind(from, "range");
  assert.equal(rangeFrom.minInput, "1500");
});

test("catalogPriceFieldErrors hides Range max until touch or save reveal", () => {
  const draft = { kind: "range" as const, minInput: "2000", maxInput: "" };
  const untouched = catalogPriceFieldErrors(draft, emptyCatalogPriceTouch(), false);
  assert.equal(untouched.max, undefined);
  assert.equal(untouched.min, undefined);

  const touchedMax = catalogPriceFieldErrors(
    draft,
    { min: false, max: true },
    false
  );
  assert.match(touchedMax.max ?? "", /amount above 0/i);

  const reveal = catalogPriceFieldErrors(draft, emptyCatalogPriceTouch(), true);
  assert.match(reveal.max ?? "", /amount above 0/i);
});
