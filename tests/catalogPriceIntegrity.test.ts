import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as cp from "../dashboard/src/lib/catalogPricing.ts";
import { priceLabel, parsePriceText, type StructuredPrice } from "../dashboard/src/lib/structuredData.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

// The 16 Done and Dusted services as they were before the owner confirmed them (Oct 12 staging).
const OLD_TEXT = [
  "Ksh 800-1200", "KSh 3,000 flat", "KSh 4,500 flat", "KSh 6,000 flat", "KSh 500 per hour (min 3 hours)",
  "Base + KSh 3,000 to 6,000", "KSh 5,000 flat (2-bed unit)", "KSh 40 per sq ft", "KSh 15,000 per visit",
  "KSh 25,000 per visit", "Custom quote (KSh 35-150 per sq m per month)", "KSh 800 per seat", "KSh 2,200 per room",
  "KSh 200 per window", "KSh 1,000 per unit", "KSh 1,200 per unit",
];
const parsedRow = (text: string, i: number) => {
  const p = parsePriceText(text);
  return {
    id: `svc_${String(i).padStart(16, "0")}`,
    name: `Service ${i}`,
    price_range: text,
    in_stock: "",
    pricing: { ...p, in_stock: null, source: "parsed", confirmed: false, parsed_from: text } as StructuredPrice,
  };
};
const confirm = (row: ReturnType<typeof parsedRow>, override?: Partial<StructuredPrice>) => {
  const pricing = { ...row.pricing, ...override, source: "owner", confirmed: true } as StructuredPrice;
  const label = priceLabel(pricing);
  return { ...row, price_range: label, pricing: { ...pricing, parsed_from: label } };
};

test("repro: confirm 16 prices, then Save the stale form: nothing reverts", () => {
  const before = OLD_TEXT.map(parsedRow);
  // Owner confirms all 16 (Carpet corrected to From KSh 2,200 per m²).
  const stored = before.map((r, i) => (i === 12 ? confirm(r, { mode: "from", amount_ksh: 2200, min_ksh: 2200, unit: "sqm" }) : confirm(r)));
  // The form never remounted: it posts the rows it loaded (old text, old parsed pricing).
  const baseline = cp.catalogBaseline(before, "service");
  const saved = cp.settleCatalogPrices(before, stored, "service", { baseline });
  saved.forEach((row, i) => {
    assert.equal(row.pricing?.confirmed, true, `${row.name} stays confirmed`);
    assert.equal(row.pricing?.source, "owner");
    assert.equal(row.price_range, stored[i].price_range, `${row.name} keeps the confirmed text`);
  });
  assert.equal(saved[12].price_range, "From KSh 2,200 per m²");
  assert.equal(saved[12].pricing?.unit, "sqm");
});

test("a price the owner edits is read again; the rest stay confirmed", () => {
  const before = OLD_TEXT.slice(0, 3).map(parsedRow);
  const stored = before.map((r) => confirm(r));
  const baseline = cp.catalogBaseline(stored, "service");
  const posted = stored.map((r, i) => (i === 1 ? { ...r, price_range: "KSh 3,500" } : r));
  const saved = cp.settleCatalogPrices(posted, stored, "service", { baseline });
  assert.equal(saved[1].pricing?.amount_ksh, 3500);
  assert.equal(saved[1].price_range, "KSh 3,500");
  assert.equal(saved[0].pricing?.confirmed, true);
  assert.equal(saved[2].pricing?.confirmed, true);
});

test("a typed price sent by the browser is never trusted", () => {
  const stored = [confirm(parsedRow("KSh 3,000 flat", 1))];
  const forged = [{ ...stored[0], pricing: { ...stored[0].pricing, amount_ksh: 1, confirmed: true } }];
  const saved = cp.settleCatalogPrices(forged, stored, "service", {});
  assert.equal(saved[0].pricing?.amount_ksh, 3000);
});

test("renaming keeps the confirmed price (id match)", () => {
  const stored = [confirm(parsedRow("KSh 3,000 flat", 1))];
  const saved = cp.settleCatalogPrices([{ ...stored[0], name: "One-bed flat" }], stored, "service", {});
  assert.equal(saved[0].pricing?.confirmed, true);
  assert.equal(saved[0].pricing?.amount_ksh, 3000);
});

test("products: id or sku match, rename keeps price, stale form keeps confirmation", () => {
  const p = parsePriceText("2500");
  const stored = [{ id: "prd_00000000000000aa", name: "Atomic Habits", sku: "", price: "KSh 2,500", unit: "", in_stock: "yes",
    pricing: { ...p, in_stock: true, source: "owner", confirmed: true, parsed_from: "KSh 2,500" } as StructuredPrice }];
  const loaded = [{ ...stored[0], price: "2500", pricing: { ...stored[0].pricing, source: "parsed", confirmed: false } }];
  const saved = cp.settleCatalogPrices([{ ...loaded[0], name: "Atomic Habits (paperback)" }], stored, "product", { baseline: cp.catalogBaseline(loaded, "product") });
  assert.equal(saved[0].pricing?.confirmed, true);
  assert.equal(saved[0].price, "KSh 2,500");
});

test("one 'no price' rule: Ask chosen by the owner is priced; empty text is not", () => {
  assert.equal(cp.isUnpricedRow({ name: "A", price: "" }, "product"), true);
  assert.equal(cp.isUnpricedRow({ name: "A", price: "", pricing: { mode: "ask", source: "owner", confirmed: true } }, "product"), false);
  assert.equal(cp.isUnpricedRow({ name: "A", price: "2,000" }, "product"), false);
  assert.equal(cp.isUnpricedRow({ name: "", price: "" }, "product"), false);
});

test("content key changes when a price is confirmed (lengths alone do not)", () => {
  const a = [parsedRow("KSh 3,000 flat", 1)];
  const b = [confirm(a[0])];
  assert.notEqual(cp.catalogContentKey(a, []), cp.catalogContentKey(b, []));
  assert.equal(cp.catalogContentKey(a, []), cp.catalogContentKey(structuredClone(a), []));
});

test("patchCatalogItem hits the id, not the first duplicate name", () => {
  const rows = [{ id: "svc_aaaaaaaaaaaaaaaa", name: "Clean" }, { id: "svc_bbbbbbbbbbbbbbbb", name: "Clean" }];
  const next = cp.patchCatalogItem(rows, { id: "svc_bbbbbbbbbbbbbbbb", name: "Clean" }, (r) => ({ ...r, hit: true }));
  assert.deepEqual(next?.map((r) => (r as { hit?: boolean }).hit), [undefined, true]);
  assert.equal(cp.patchCatalogItem(rows, { id: "svc_cccccccccccccccc", name: "Gone" }, (r) => r), null);
});

test("imported items get an unconfirmed typed price", () => {
  const row = cp.withImportedPricing({ name: "Book", price: "KSh 1,200" }, "product");
  assert.equal(row.pricing?.amount_ksh, 1200);
  assert.equal(row.pricing?.confirmed, false);
  assert.equal(row.pricing?.source, "parsed");
});

// Wiring: the save, confirm and import paths use the shared rules.
test("wiring: Settings save settles prices on the server, never from client pricing", () => {
  const src = read("dashboard/src/app/(desk)/settings/actions.ts");
  assert.ok(src.includes("settleCatalogPrices("), "save uses settleCatalogPrices");
  assert.ok(!src.includes("const prev = row.pricing ? row"), "client pricing no longer wins");
});

test("wiring: form remounts on catalogue content, not lengths", () => {
  const src = read("dashboard/src/components/BusinessSettingsShell.tsx");
  assert.ok(src.includes("catalogContentKey("));
});

test("wiring: confirm-price patches one item by id from a fresh read", () => {
  const src = read("dashboard/src/app/(desk)/settings/structuredActions.ts");
  assert.ok(src.includes("patchCatalogItem("));
  assert.ok(/readCatalogFresh\(/.test(src));
});

test("wiring: import merges into a fresh read and stamps typed prices", () => {
  const src = read("dashboard/src/app/(desk)/settings/catalogActions.ts");
  assert.ok(/readCatalogFresh\(/.test(src));
  assert.ok(src.includes("withImportedPricing("));
});

test("wiring: Add prices list freezes while typing and uses the shared rule", () => {
  const src = read("dashboard/src/components/TenantForm.tsx");
  assert.ok(src.includes("isUnpricedRow("));
  assert.ok(src.includes("unpricedFrozen"));
  assert.ok(!/products\.length \/ PRODUCT_PAGE_SIZE/.test(src), "Add product uses the visible list");
});

// --- fact hash contract: confirmPriceAction re-stamps the .price hash -------

test("catalogPricePath keys a service by stable id and a product by sku, else position", () => {
  const services = [{ id: "svc_a", name: "A" }, { id: "7", name: "B" }, { name: "C" }];
  assert.equal(cp.catalogPricePath("service", services, 0), "catalog.service.svc_a.price");
  assert.equal(cp.catalogPricePath("service", services, 1), "catalog.service.2.price");
  assert.equal(cp.catalogPricePath("service", services, 2), "catalog.service.3.price");
  const products = [{ sku: " P1 ", name: "Ream" }, { name: "Pens" }];
  assert.equal(cp.catalogPricePath("product", products, 0), "catalog.product.P1.price");
  assert.equal(cp.catalogPricePath("product", products, 1), "catalog.product.2.price");
  assert.equal(cp.catalogPricePath("service", services, -1), null);
  assert.equal(cp.catalogPricePath("service", services, 9), null);
});

test("confirm rewrite: the re-stamped .price hash matches the saved row, and the envelope does not move .name", async () => {
  const { planFactConfirm } = await import("../dashboard/src/lib/factConfirm.ts");
  const { factValueForPath, hashFactValue } = await import("../dashboard/src/lib/factHash.ts");
  const before = {
    services_catalog: [
      { id: "svc_a", name: "Carpet", price_range: "KES 900", pricing: { mode: "fixed", amount_ksh: 900, source: "parsed", confirmed: false, parsed_from: "900" } },
    ],
  };
  const saved = {
    services_catalog: [
      { id: "svc_a", name: "Carpet", price_range: "KES 900", source: "owner", pricing: { mode: "fixed", amount_ksh: 900, source: "owner", confirmed: true, parsed_from: "KES 900" } },
    ],
  };
  const path = cp.catalogPricePath("service", saved.services_catalog, 0)!;
  const plan = planFactConfirm({ scope: "catalog", before: saved, after: saved, explicitPaths: [path] });
  assert.deepEqual(plan.confirm, [{ path, hash: hashFactValue(factValueForPath(path, saved)) }]);
  assert.deepEqual(plan.reopen, []);
  // Only the envelope changed, so the row's .name hash is the same as before the confirm.
  const name = "catalog.service.svc_a.name";
  assert.equal(hashFactValue(factValueForPath(name, saved)), hashFactValue(factValueForPath(name, before)));
});

test("confirmPriceAction re-stamps the .price hash after it writes the row", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "dashboard/src/app/(desk)/settings/structuredActions.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function confirmPriceAction"));
  const write = body.indexOf('.from("tenants").update(');
  const stamp = body.indexOf("restampPriceHash(");
  assert.ok(write > 0 && stamp > write, "re-stamp runs after the tenants update");
  assert.match(src, /explicitPaths: \[path, namePath\]/);
});

test("confirm with no real change: re-stamped .price and .name both match the stored row", async () => {
  const { planFactConfirm } = await import("../dashboard/src/lib/factConfirm.ts");
  const { factValueForPath, hashFactValue } = await import("../dashboard/src/lib/factHash.ts");
  for (const text of ["KSh 3,000 flat", "Ksh 800-1200"]) {
    const row = parsedRow(text, 1);
    const before = { services_catalog: [row] };
    const saved = { services_catalog: [{ ...confirm(row), source: "owner" }] };
    const pricePath = cp.catalogPricePath("service", saved.services_catalog, 0)!;
    const namePath = pricePath.replace(/\.price$/, ".name");
    // priceLabel rewrites the text, so the .name value moves even though the owner said "yes".
    assert.notEqual(saved.services_catalog[0].price_range, text);
    assert.notEqual(hashFactValue(factValueForPath(namePath, saved)), hashFactValue(factValueForPath(namePath, before)));
    const plan = planFactConfirm({ scope: "catalog", before: saved, after: saved, explicitPaths: [pricePath, namePath] });
    const got = Object.fromEntries(plan.confirm.map((c: { path: string; hash: string }) => [c.path, c.hash]));
    assert.equal(got[pricePath], hashFactValue(factValueForPath(pricePath, saved)));
    assert.equal(got[namePath], hashFactValue(factValueForPath(namePath, saved)));
    assert.deepEqual(plan.reopen, []);
  }
});

// --- fact hash re-stamp failure visibility -----------------------------------

test("factHashRestampFailurePayload is structured: tenant id, item path, error; no PII fields", async () => {
  const { factHashRestampFailurePayload } = await import("../dashboard/src/lib/factHashRestampReport.ts");
  const payload = factHashRestampFailurePayload({
    tenantId: "df4ad9d8-aaaa-bbbb-cccc-ddddeeeeffff",
    itemPath: "catalog.service.svc_a.price",
    error: new Error("rpc confirm_tenant_fields_batch failed"),
  });
  assert.deepEqual(payload, {
    tenantId: "df4ad9d8-aaaa-bbbb-cccc-ddddeeeeffff",
    itemPath: "catalog.service.svc_a.price",
    error: "rpc confirm_tenant_fields_batch failed",
  });
  assert.equal("name" in payload, false);
  assert.equal("price" in payload, false);
  assert.equal("price_range" in payload, false);
});

test("reportFactHashRestampFailure logs a structured fact_hash_restamp_failed error", async () => {
  const { reportFactHashRestampFailure } = await import("../dashboard/src/lib/factHashRestampReport.ts");
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { errors.push(args[0]); };
  try {
    reportFactHashRestampFailure({
      tenantId: "t1",
      itemPath: "catalog.service.svc_a.price",
      error: "stamp failed",
    });
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 1);
  const parsed = JSON.parse(String(errors[0]));
  assert.equal(parsed.event, "fact_hash_restamp_failed");
  assert.equal(parsed.tenantId, "t1");
  assert.equal(parsed.itemPath, "catalog.service.svc_a.price");
  assert.equal(parsed.error, "stamp failed");
});

test("confirmPriceAction reports re-stamp failures instead of a silent console.warn", () => {
  const src = read("dashboard/src/app/(desk)/settings/structuredActions.ts");
  const body = src.slice(src.indexOf("async function restampPriceHash"));
  assert.ok(src.includes('reportFactHashRestampFailure'), "imports/uses the reporter");
  assert.ok(body.includes("reportFactHashRestampFailure({"), "failure path calls the reporter");
  assert.ok(body.includes("itemPath: path"), "logs the item path, not the item name");
  assert.ok(!/console\.warn\(\s*"\[confirmPriceAction\] price hash"/.test(src), "old silent warn removed");
});
