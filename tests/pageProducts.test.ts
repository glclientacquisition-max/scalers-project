/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/pageProducts.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { filterPageProducts, looksLikeProductName } from "../dashboard/src/lib/ingest/pageProducts.ts";
import { parseBulkProducts } from "../dashboard/src/lib/productCatalog.ts";

it("drops page titles and paragraphs from a URL scrape", () => {
  const page = "Example Domain\nThis domain is for use in illustrative examples in documents. You may use this domain without permission.\nA4 paper - 500 KES\nBinding - 300 KES";
  const rows = filterPageProducts(parseBulkProducts(page), { requirePrice: true });
  assert.deepEqual(rows.map((r) => r.name).sort(), ["A4 paper", "Binding"]);
});
it("name heuristics", () => {
  assert.equal(looksLikeProductName("Welcome to Aris Stationers"), false);
  assert.equal(looksLikeProductName("This is a long sentence about our shop and history."), false);
  assert.equal(looksLikeProductName("Exercise book 96pg"), true);
});
it("pasted text lines still parse into reviewable products", () => {
  assert.equal(parseBulkProducts("A4 paper - 500 KES\nBinding - 300 KES").length, 2);
});
