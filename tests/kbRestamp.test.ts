// PR 1 (30 Oct): owner KB writes re-stamp catalogue fact hashes. The .name hash covers the whole mirrored row,
// so a Catalogue save that skipped tenant_field_meta left DnD 11/11 names stale on staging.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogRestampPaths } from "../dashboard/src/lib/kbRestamp.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const owner = { confirmed: true, source: "owner" };
const saved = {
  services_catalog: [
    { id: "deep-clean", name: "Deep clean", pricing: { ...owner, mode: "range" } },
    { id: "sofa", name: "Sofa", pricing: { confirmed: false, source: "parsed", mode: "ask" } },
    { id: "office", name: "Office", pricing: { ...owner, mode: "fixed" } },
  ],
  product_catalog: [{ id: "p1", sku: "SKU-1", name: "Seedling", pricing: { ...owner, mode: "fixed" } }],
};

describe("catalogRestampPaths", () => {
  it("stamps name and owner price for written items", () => {
    assert.deepEqual(catalogRestampPaths(saved, ["deep-clean"]), ["catalog.service.deep-clean.name", "catalog.service.deep-clean.price"]);
  });
  it("never stamps an unconfirmed (no price yet) price", () => {
    assert.deepEqual(catalogRestampPaths(saved, ["sofa"]), ["catalog.service.sofa.name"]);
  });
  it("products key by sku", () => {
    assert.deepEqual(catalogRestampPaths(saved, ["p1"]), ["catalog.product.SKU-1.name", "catalog.product.SKU-1.price"]);
  });
  it("re-stamps rows the owner already confirmed (mirror rewrite), never promotes seed rows", () => {
    const got = catalogRestampPaths(saved, [], ["catalog.service.office.name", "catalog.service.office.price", "catalog.service.gone.name"]);
    assert.deepEqual(got, ["catalog.service.office.name", "catalog.service.office.price"]);
    assert.ok(!got.some((p) => p.includes("sofa") || p.includes("deep-clean")));
  });
});

describe("wiring", () => {
  it("Desk KB writes pass restampIds; onboarding/API writers do not", () => {
    assert.match(read("dashboard/src/app/(desk)/settings/knowledge/actions.ts"), /afterKbWrite\(tenantId, "desk", \{ restampIds \}\)/);
    const w = read("dashboard/src/lib/kbWrite.server.ts");
    assert.match(w, /restampKbCatalogMeta\(tenantId, opts\.restampIds\)/);
    assert.match(w, /explicitPaths: paths/);
  });
});
