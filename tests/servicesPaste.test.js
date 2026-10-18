const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require(path.join(root, "dashboard/node_modules/jiti"))(__filename, {
  alias: { "@": path.join(root, "dashboard/src") },
});
const { parseBulkServices } = jiti(path.join(root, "dashboard/src/lib/servicesCatalog.ts"));
const { catalogSaveError, omitUnsavedPrices } = jiti(path.join(root, "dashboard/src/lib/catalogValidation.ts"));
const { settleCatalogPrices } = jiti(path.join(root, "dashboard/src/lib/catalogPricing.ts"));

function row(line) {
  const parsed = parseBulkServices(line);
  assert.equal(parsed.length, 1, line);
  return parsed[0];
}

describe("paste list splits a price off the service name", () => {
  const kept = [
    ["Window cleaning KSh 60 per sq ft", "Window cleaning", "KSh 60 per sq ft"],
    ["Garden clearing KSh 3,000 per job", "Garden clearing", "KSh 3,000 per job"],
    ["Ironing KSh 250 /kg", "Ironing", "KSh 250 /kg"],
    ["Nanny hire KSh 1,200 per day", "Nanny hire", "KSh 1,200 per day"],
    ["Office cleaning KSh 8,000 a month", "Office cleaning", "KSh 8,000 a month"],
    ["Deep clean price depends on size", "Deep clean", "price depends on size"],
    ["Sofa cleaning Ksh 500 per seat", "Sofa cleaning", "Ksh 500 per seat"],
    ["Windows KES 200 per window", "Windows", "KES 200 per window"],
    ["Home cleaning: KSh 2,500", "Home cleaning", "KSh 2,500"],
    ["Garden clearing, KSh 3,000 per job", "Garden clearing", "KSh 3,000 per job"],
    ["Home cleaning - from 2,500 KES", "Home cleaning", "from 2,500 KES"],
    ["Electrical - quote after visit", "Electrical", "quote after visit"],
  ];

  for (const [line, name, price] of kept) {
    it(line, () => {
      const parsed = row(line);
      assert.equal(parsed.name, name);
      assert.equal(parsed.price_range, price);
    });
  }

  it("leaves a name-only line alone", () => {
    const parsed = row("Plumbing");
    assert.equal(parsed.name, "Plumbing");
    assert.equal(parsed.price_range, "");
  });

  it("keeps spreadsheet columns", () => {
    const parsed = row("Sofa | KSh 1,500 | soft fabrics | leather");
    assert.equal(parsed.name, "Sofa");
    assert.equal(parsed.price_range, "KSh 1,500");
    assert.equal(parsed.notes, "soft fabrics");
    assert.equal(parsed.out_of_scope, "leather");
  });

  it("does not split a comma inside the amount", () => {
    const parsed = row("Garden clearing KSh 3,000 per job");
    assert.equal(parsed.name, "Garden clearing");
    assert.equal(parsed.price_range, "KSh 3,000 per job");
  });
});

describe("paste then save keeps ask wording and the other rows", () => {
  const pasted = [
    "Window cleaning KSh 60 per sq ft",
    "Garden clearing KSh 3,000 per job",
    "Ironing KSh 250 /kg",
    "Office cleaning KES 8,000 a month",
    "Deep clean price depends on size",
    "Nope - abc",
  ].join("\n");

  it("accepts the lines the preview splits, including depends on size", () => {
    const rows = parseBulkServices(pasted);
    assert.deepEqual(
      rows.map((row) => [row.name, row.price_range]),
      [
        ["Window cleaning", "KSh 60 per sq ft"],
        ["Garden clearing", "KSh 3,000 per job"],
        ["Ironing", "KSh 250 /kg"],
        ["Office cleaning", "KES 8,000 a month"],
        ["Deep clean", "price depends on size"],
        ["Nope", "abc"],
      ]
    );
    const split = omitUnsavedPrices(rows, "price_range");
    assert.deepEqual(
      split.rows.map((row) => row.name),
      ["Window cleaning", "Garden clearing", "Ironing", "Office cleaning", "Deep clean"]
    );
    assert.equal(split.issues.length, 1);
    assert.match(split.issues[0].message, /Nope:.*"abc" isn't a price/);
    assert.equal(catalogSaveError({ services: split.rows }), null);

    const settled = settleCatalogPrices(split.rows, [], "service");
    const deep = settled.find((row) => row.name === "Deep clean");
    assert.equal(deep.price_range, "price depends on size");
    assert.equal(deep.pricing.mode, "ask");
    assert.equal(deep.pricing.amount_ksh, null);

    const office = settled.find((row) => row.name === "Office cleaning");
    assert.equal(office.price_range, "KES 8,000 a month");
    assert.equal(office.pricing.mode, "fixed");
    assert.equal(office.pricing.amount_ksh, 8000);
  });
});

describe("catalogue note fields do not look filled in", () => {
  it("drops the repeated example notes", () => {
    const form = fs.readFileSync(path.join(root, "dashboard/src/components/TenantForm.tsx"), "utf8");
    assert.doesNotMatch(form, /placeholder="Free quotation"/);
    assert.doesNotMatch(form, /placeholder="No commercial offices"/);
  });
});
