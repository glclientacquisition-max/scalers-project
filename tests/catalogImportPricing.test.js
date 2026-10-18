const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiModule;
try {
  jitiModule = require(path.join(root, "dashboard/node_modules/jiti"));
} catch {
  jitiModule = require("jiti");
}
const jiti = (jitiModule.createJiti || jitiModule)(__filename, {
  alias: { "@": path.join(root, "dashboard/src") },
});

const {
  catalogImportPriceLabel,
  parseCatalogPricingMode,
  structureImportedCatalogRow,
} = jiti(path.join(root, "dashboard/src/lib/catalogPricingMode.ts"));
const { parseBulkProducts, parseProductCsv } = jiti(path.join(root, "dashboard/src/lib/productCatalog.ts"));
const { parseBulkServices } = jiti(path.join(root, "dashboard/src/lib/servicesCatalog.ts"));
const { suggestImportedProducts, suggestImportedServices } = jiti(
  path.join(root, "dashboard/src/lib/catalogSuggest.ts")
);
const cp = jiti(path.join(root, "dashboard/src/lib/catalogPricing.ts"));
const { rowFromImport } = jiti(path.join(root, "dashboard/src/lib/setupFlow.ts"));

const FIXTURES = [
  { label: "Ask", text: "Ask", kind: "quote" },
  { label: "call for price", text: "call for price", kind: "quote" },
  { label: "from 1500", text: "from 1500", kind: "from" },
  { label: "500-800", text: "500-800", kind: "range" },
  { label: "2,000", text: "2,000", kind: "fixed" },
  { label: "KSh 2,000", text: "KSh 2,000", kind: "fixed" },
  { label: "empty", text: "", kind: "quote" },
];

test("parseCatalogPricingMode fixtures", () => {
  for (const f of FIXTURES) {
    assert.equal(parseCatalogPricingMode(f.text).kind, f.kind, f.label);
  }
});

test("parseBulkServices sets pricing_mode from pasted price text", () => {
  const row = parseBulkServices("Deep clean - from 1500")[0];
  assert.equal(row.pricing_mode, "from");
  assert.equal(row.price, "1500");
  assert.match(catalogImportPriceLabel(row), /from/i);

  const quote = parseBulkServices("Install - Ask")[0];
  assert.equal(quote.pricing_mode, "quote");
  assert.equal(catalogImportPriceLabel(quote), "Quote");
  assert.equal(quote.price_range, "");
});

test("parseBulkProducts line import structures prices", () => {
  const row = parseBulkProducts("Notebook - KSh 2,000")[0];
  assert.equal(row.pricing_mode, "fixed");
  assert.ok(row.price.includes("2") && row.price.includes("000"));
  assert.match(catalogImportPriceLabel(row), /2/);
});

test("parseProductCsv structures ask and range", () => {
  const rows = parseProductCsv("name,price\nWidget,call for price\nCable,500-800");
  assert.equal(rows[0].pricing_mode, "quote");
  assert.equal(catalogImportPriceLabel(rows[0]), "Quote");
  assert.equal(rows[1].pricing_mode, "range");
  assert.equal(rows[1].price_max, 800);
  assert.match(String(rows[1].price), /500/);
});

test("suggestImportedServices keeps structured quote (not literal Ask text)", () => {
  const [row] = suggestImportedServices(parseBulkServices("Plumbing - call for price"), null);
  assert.equal(row.pricing_mode, "quote");
  assert.equal(row.price_range, "");
  assert.equal(catalogImportPriceLabel(row), "Quote");
});

test("withImportedPricing hydrates structured fields on products", () => {
  const row = cp.withImportedPricing(
    { name: "Pen", price: "from 1500", category: "", sku: "", notes: "", aliases: [] },
    "product"
  );
  assert.equal(row.pricing_mode, "from");
  assert.match(String(row.price), /1,500/);
  assert.equal(row.pricing?.confirmed, false);
});

test("rowFromImport onboarding CSV mapping", () => {
  assert.equal(rowFromImport("a", "call for price").pricing_mode, "ask");
  assert.equal(rowFromImport("b", "from 1500").pricing_mode, "from");
  assert.equal(rowFromImport("c", "500-800").pricing_mode, "range");
  assert.equal(rowFromImport("d", "KSh 2,000").price, "2,000");
});

test("structureImportedCatalogRow preview labels", () => {
  const serviceRow = (priceRange) =>
    structureImportedCatalogRow(
      {
        name: "Sample service",
        price_range: priceRange,
        notes: "",
        out_of_scope: "",
        in_stock: "",
        category: "",
      },
      "price_range"
    );
  const productRow = (price) =>
    structureImportedCatalogRow(
      { name: "Sample product", sku: "", price, category: "", notes: "", aliases: [], in_stock: "" },
      "price"
    );
  assert.equal(catalogImportPriceLabel(serviceRow("")), "Quote");
  assert.match(catalogImportPriceLabel(serviceRow("from 1500")), /1,500/);
  assert.match(catalogImportPriceLabel(productRow("2,000")), /2/);
});
