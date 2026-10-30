// PR 4 (30 Oct): "Is this right?" and product import write kb_items once the KB exists, so the mirror never undoes them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { kbPriceEdits } from "../dashboard/src/lib/kbPriceConfirm.ts";
import type { KbItem } from "../dashboard/src/lib/kbCore.ts";

const item = (o: Partial<KbItem>): KbItem => ({
  id: "svc_a", kind: "service", name_en: "Deep clean", name_sw: null, name_sw_state: "none", name_sw_suggested: null, aliases: [],
  category_id: null, description_en: null, unit: null, price_mode: "none", price_amount: null, price_min: null, price_max: null,
  in_stock: null, popular: false, delivery_fee_kes: null, needs_visit: false, holdable: false, excludes_en: null, status_note: null,
  status: "active", sort: 0, source: "legacy", legacy_ref: null, row_version: 1, ...o,
});
const price = (o: Record<string, unknown>) => ({ mode: "fixed", amount_ksh: 1500, min_ksh: null, max_ksh: null, unit: null, in_stock: null, source: "owner", confirmed: true, ...o }) as never;

test("fixed price by id", () => {
  const r = kbPriceEdits([item({})], [{ kind: "service", id: "svc_a", name: "x", pricing: price({}) }]);
  assert.ok(r.ok);
  assert.equal(r.ok && r.edits[0].price_mode, "fixed");
  assert.equal(r.ok && r.edits[0].price_amount, 1500);
});

test("range by name, packages count as services", () => {
  const r = kbPriceEdits([item({ id: "pkg_1", kind: "package", name_en: "Move-in" })], [{ kind: "service", name: "move-in", pricing: price({ mode: "range", amount_ksh: 2000, max_ksh: 5000 }) }]);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && [r.edits[0].price_min, r.edits[0].price_max, r.edits[0].price_amount], [2000, 5000, null]);
});

test("ask keeps a site visit as a site visit, else quote", () => {
  const a = kbPriceEdits([item({ price_mode: "site_visit" })], [{ kind: "service", id: "svc_a", name: "", pricing: price({ mode: "ask", amount_ksh: null }) }]);
  const b = kbPriceEdits([item({})], [{ kind: "service", id: "svc_a", name: "", pricing: price({ mode: "ask", amount_ksh: null }) }]);
  assert.equal(a.ok && a.edits[0].price_mode, "site_visit");
  assert.equal(b.ok && b.edits[0].price_mode, "quote");
});

test("one bad or missing item saves nothing", () => {
  assert.equal(kbPriceEdits([item({})], [{ kind: "service", id: "svc_a", name: "", pricing: price({ amount_ksh: null }) }]).ok, false);
  assert.equal(kbPriceEdits([item({})], [{ kind: "product", name: "Deep clean", pricing: price({}) }]).ok, false);
});

test("actions use the KB when it exists", () => {
  const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
  const s = read("dashboard/src/app/(desk)/settings/structuredActions.ts");
  assert.ok(s.indexOf("loadKbItems(tenantId)") < s.indexOf("runPriceBatch("));
});
