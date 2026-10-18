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
  assert.equal(catalogImportPriceLabel(quote), "Ask");
  assert.equal(quote.price_range, "Ask");
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
  assert.equal(catalogImportPriceLabel(rows[0]), "call for price");
  assert.equal(rows[1].pricing_mode, "range");
  assert.equal(rows[1].price_max, 800);
  assert.match(String(rows[1].price), /500/);
});

test("suggestImportedServices keeps structured quote (not literal Ask text)", () => {
  const [row] = suggestImportedServices(parseBulkServices("Plumbing - call for price"), null);
  assert.equal(row.pricing_mode, "quote");
  assert.equal(row.price_range, "call for price");
  assert.equal(catalogImportPriceLabel(row), "call for price");
});

test("withImportedPricing hydrates structured fields on products", () => {
  const row = cp.withImportedPricing(
    { name: "Pen", price: "from 1500", category: "", sku: "", notes: "", aliases: [] },
    "product"
  );
  assert.equal(row.pricing_mode, "from");
  assert.equal(row.price, "from 1500");
  assert.equal(row.pricing?.confirmed, false);
});

test("rowFromImport onboarding CSV mapping", () => {
  assert.equal(rowFromImport("a", "call for price").pricing_mode, "ask");
  assert.equal(rowFromImport("b", "from 1500").pricing_mode, "from");
  assert.equal(rowFromImport("c", "500-800").pricing_mode, "range");
  assert.equal(rowFromImport("d", "KSh 2,000").price, "2,000");
});

const UNIT_SUFFIX_LINES = [
  ["Carpet wash KSh 60 per sq ft", "fixed", 60, "KSh 60 per sq ft"],
  ["Venue hire KSh 2,000 per seat", "fixed", 2000, "KSh 2,000 per seat"],
  ["Consulting KSh 5,000 /hr", "fixed", 5000, "KSh 5,000 /hr"],
  ["Labour KSh 800 kwa saa", "fixed", 800, "KSh 800 kwa saa"],
  ["Pest control KSh 1,200 per visit", "fixed", 1200, "KSh 1,200 per visit"],
  ["Rooms - from KSh 1,500 per room", "from", 1500, "from KSh 1,500 per room"],
  ["Hourly cleaning - 500-800 per hour", "range", 500, "500-800 per hour"],
];

test("paste import keeps unit suffixes on price_range", () => {
  for (const [line, mode, amount, priceRange] of UNIT_SUFFIX_LINES) {
    const row = parseBulkServices(line)[0];
    assert.equal(row.pricing_mode, mode, line);
    assert.equal(row.price_range, priceRange, line);
    assert.equal(row.price, String(amount), line);
    if (mode === "range") assert.equal(row.price_max, 800, line);
  }
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
  assert.equal(catalogImportPriceLabel(serviceRow("from 1500")), "from 1500");
  assert.match(catalogImportPriceLabel(productRow("2,000")), /2/);
});
