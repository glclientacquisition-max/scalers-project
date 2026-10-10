/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/catalogValidation.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { catalogSaveError, priceTextError } from "../dashboard/src/lib/catalogValidation.ts";

it("rejects -50 and abc, accepts real prices", () => {
  assert.ok(priceTextError("-50"));
  assert.ok(priceTextError("abc"));
  for (const ok of ["150", "KSh 1,200", "from 300", "200-400", "ask", ""]) assert.equal(priceTextError(ok), null, ok);
});
it("names the bad row and catches duplicates", () => {
  assert.match(String(catalogSaveError({ products: [{ name: "Pen", price: "-50" }] })), /^Pen:/);
  assert.match(String(catalogSaveError({ services: [{ name: "Binding", price_range: "100" }, { name: "binding", price_range: "100" }] })), /twice/);
  assert.equal(catalogSaveError({ products: [{ name: "Pen", price: "50" }] }), null);
});
