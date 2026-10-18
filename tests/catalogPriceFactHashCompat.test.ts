import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { factValueForPath, hashFactValue, priceFactValue } from "../dashboard/src/lib/factHash.ts";

const require = createRequire(import.meta.url);
const jsFactHash = require("../src/conversation/factHash.js");

const FIXTURE = JSON.parse(readFileSync("tests/fixtures/factHashVectors.json", "utf8"));
const PATH_TENANT = FIXTURE.pathTenant;
const PRICE_PATH_VECTORS = FIXTURE.pathVectors.filter((v: { path: string }) => /\.price$/.test(v.path));

/** Legacy catalogue rows (pre-#790 shape): only display text + pricing_mode, no structured price/price_max. */
const LEGACY_ROWS: Array<{ name: string; row: Record<string, unknown>; kind: "service" | "product" }> = [
  {
    name: "range + text",
    kind: "service",
    row: { price_range: "KES 1,500 - 2,000", pricing_mode: "range" },
  },
  {
    name: "from + text",
    kind: "service",
    row: { price_range: "From KES 800", pricing_mode: "from" },
  },
  {
    name: "fixed + text",
    kind: "service",
    row: { price_range: "KES 2,500", pricing_mode: "fixed" },
  },
  {
    name: "legacy ask",
    kind: "service",
    row: { price_range: "", pricing_mode: "ask" },
  },
  {
    name: "quote mode (already on main)",
    kind: "service",
    row: { price_range: "", pricing_mode: "quote" },
  },
  {
    name: "structured fields must not change hash payload",
    kind: "service",
    row: {
      price_range: "KES 1,500 - 2,000",
      pricing_mode: "range",
      price: "1500",
      price_max: 2000,
    },
  },
];

function jsPriceFactValue(row: unknown, kind: "service" | "product") {
  return jsFactHash.priceFactValue(row, kind);
}

test("priceFactValue matches main path vectors (byte-identical hashes)", () => {
  for (const v of PRICE_PATH_VECTORS) {
    const value = factValueForPath(v.path, PATH_TENANT);
    assert.deepEqual(value, v.value, v.name);
    assert.equal(hashFactValue(value), v.sha256, v.name);
  }
});

test("legacy catalogue rows: TS priceFactValue hashes match pinned main semantics", () => {
  const pins = new Map<string, string>();
  for (const v of PRICE_PATH_VECTORS) {
    if (v.value) pins.set(JSON.stringify(v.value), v.sha256);
  }
  pins.set(JSON.stringify({ mode: "ask" }), hashFactValue({ mode: "ask" }));
  pins.set(JSON.stringify({ mode: "fixed", price: "KES 2,500" }), hashFactValue({ mode: "fixed", price: "KES 2,500" }));
  pins.set(JSON.stringify({ mode: "from", price: "From KES 800" }), hashFactValue({ mode: "from", price: "From KES 800" }));

  for (const { name, row, kind } of LEGACY_ROWS) {
    const value = priceFactValue(row, kind);
    const withStructured = row.price_max
      ? priceFactValue({ price_range: row.price_range, pricing_mode: row.pricing_mode }, kind)
      : null;
    if (withStructured) {
      assert.deepEqual(value, withStructured, `${name}: extra price/price_max must not appear in hash leaf`);
    }
    const sha = hashFactValue(value);
    const again = hashFactValue(priceFactValue(row, kind));
    assert.equal(sha, again, `${name}: idempotent`);
    if (row.pricing_mode === "ask") {
      assert.deepEqual(value, { mode: "ask" }, `${name}: ask stays ask in hash leaf`);
    }
    if (row.pricing_mode === "quote") {
      assert.deepEqual(value, { mode: "quote" });
      assert.equal(sha, pins.get(JSON.stringify({ mode: "quote" })));
    }
    if (row.pricing_mode === "range" && row.price_range === "KES 1,500 - 2,000") {
      assert.equal(sha, "f37550ddd8b3d005d2605eb076cfc4f3c1031850af4befac5c3b5d9e5dc3a3c2");
    }
  }
});

test("JS and TS price leaves match for legacy rows", () => {
  for (const { row, kind } of LEGACY_ROWS) {
    const ts = priceFactValue(row, kind);
    const js = jsPriceFactValue({ ...row, id: "legacy" }, kind);
    assert.deepEqual(js, ts);
    assert.equal(jsFactHash.hashFactValue(js), hashFactValue(ts));
  }
});
