// PR 2 (30 Oct): no-op saves and honest saved lines in the Catalogue.
// Run: node --experimental-strip-types --no-warnings --import ./tests/registerTs.mjs --test tests/catalogueSaveHonest.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { draftFromItem, itemFromDraft, sameKbContent, type KbItem } from "../dashboard/src/lib/kbCore.ts";
import { draftDirty, savedLine } from "../dashboard/src/lib/catalogueView.ts";

const item: KbItem = {
  id: "deep-clean", kind: "service", name_en: "Deep clean", name_sw: null, name_sw_state: "none", name_sw_suggested: null, aliases: [],
  category_id: null, description_en: null, unit: null, price_mode: "range", price_amount: null, price_min: 6000, price_max: 12000, in_stock: null,
  popular: false, delivery_fee_kes: null, needs_visit: false, holdable: false, excludes_en: null, status_note: null, status: "active", sort: 1,
  source: "legacy", legacy_ref: "services_catalog", row_version: 4,
} as KbItem;

test("an unchanged draft round-trips to the same content (server skips the write)", () => {
  const d = draftFromItem(item, []);
  assert.ok(sameKbContent(itemFromDraft(d, item, null), item));
  assert.ok(!sameKbContent(itemFromDraft({ ...d, price_max: "13000" }, item, null), item));
});

test("Save is enabled only for a new item or a changed draft", () => {
  const d = draftFromItem(item, []);
  assert.equal(draftDirty(d, d), false);
  assert.equal(draftDirty({ ...d, name_en: "Deep clean+" }, d), true);
  const fresh = { ...d, id: undefined };
  assert.equal(draftDirty(fresh, fresh), true);
});

test("saved line never says on calls when it is not", () => {
  const d = draftFromItem(item, []);
  assert.equal(savedLine(d, { unchanged: true }), "Nothing changed.");
  assert.equal(savedLine(d, { restamped: false }), "Saved. Calls will use it after the next check.");
  assert.equal(savedLine(d), "Saved. On calls within a minute.");
});

test("wiring: server short-circuits, sheet disables Save", () => {
  const a = fs.readFileSync("dashboard/src/app/(desk)/settings/knowledge/actions.ts", "utf8");
  assert.match(a, /sameKbContent\(item, prev\)\) return \{ ok: true, unchanged: true \}/);
  const s = fs.readFileSync("dashboard/src/components/catalogue/CatalogueScreen.tsx", "utf8");
  assert.match(s, /disabled=\{!dirty\}/);
  assert.match(s, /No changes yet/);
});
