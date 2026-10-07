const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function evalTs(expr) {
  const out = execFileSync(
    "npx",
    ["tsx", "-e", expr],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } }
  );
  return JSON.parse(out.trim());
}

const emptyService = {
  name: "",
  price_range: "",
  notes: "",
  out_of_scope: "",
  in_stock: "",
  category: "",
};

const emptyProduct = {
  name: "",
  sku: "",
  category: "",
  price: "",
  unit: "",
  in_stock: "",
  notes: "",
  aliases: [],
};

describe("catalogSuggest", () => {
  it("splits carpet cleaning quotation into ask pricing", () => {
    const row = evalTs(`
      import { suggestServiceRow } from "./dashboard/src/lib/catalogSuggest.ts";
      console.log(JSON.stringify(suggestServiceRow(${JSON.stringify({
        ...emptyService,
        name: "Carpet cleaning - quotation",
      })})));
    `);
    assert.equal(row.name, "Carpet cleaning");
    assert.equal(row.pricing_mode, "ask");
    assert.equal(row.changed, true);
  });

  it("expands 96pg shorthand into spoken name and alias", () => {
    const row = evalTs(`
      import { suggestProductRow } from "./dashboard/src/lib/catalogSuggest.ts";
      console.log(JSON.stringify(suggestProductRow(${JSON.stringify({
        ...emptyProduct,
        name: "96pg exe book",
        price: "450 KES",
      })})));
    `);
    assert.match(row.name, /96 page exercise book/i);
    assert.ok(row.aliases.some((a) => /96pg/i.test(a)));
    assert.equal(row.price, "450 KES");
  });

  it("moves from-price tail off the service name", () => {
    const row = evalTs(`
      import { suggestServiceRow } from "./dashboard/src/lib/catalogSuggest.ts";
      console.log(JSON.stringify(suggestServiceRow(${JSON.stringify({
        ...emptyService,
        name: "Home cleaning - from 2,500 KES",
      })})));
    `);
    assert.equal(row.name, "Home cleaning");
    assert.match(row.price_range, /2,500/i);
    assert.equal(row.pricing_mode, "from");
  });

  it("tags import source on suggested rows", () => {
    const row = evalTs(`
      import { suggestImportedServices } from "./dashboard/src/lib/catalogSuggest.ts";
      console.log(JSON.stringify(suggestImportedServices([${JSON.stringify({
        ...emptyService,
        name: "Plumbing - quote",
      })}])[0]));
    `);
    assert.equal(row.source, "import");
  });
});
