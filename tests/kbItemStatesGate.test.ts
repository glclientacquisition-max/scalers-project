// Catalogue save with DESK_KB_ITEM_STATES off: a change to Paused / Not offered is ignored (stored state kept),
// the rest of the save goes through, and an already-paused item is never silently flipped.
// Run: node --experimental-strip-types --no-warnings --import ./tests/registerTs.mjs --test tests/kbItemStatesGate.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { draftFromItem, gateDraftStatus, itemFromDraft, type KbDraft, type KbItem } from "../dashboard/src/lib/kbCore.ts";

const item = (o: Partial<KbItem> & { id: string; name_en: string }): KbItem => ({
  kind: "service", name_sw: null, name_sw_state: "none", name_sw_suggested: null, aliases: [], category_id: null, description_en: null,
  unit: null, price_mode: "fixed", price_amount: 2000, price_min: null, price_max: null, in_stock: null, popular: false, delivery_fee_kes: null,
  needs_visit: false, holdable: false, excludes_en: null, status_note: null, status: "active", sort: 0, source: "owner", legacy_ref: null, row_version: 1, ...o,
});
const save = (prev: KbItem | null, d: KbDraft, on: boolean) => itemFromDraft(gateDraftStatus(d, prev, on), prev, null);

test("flag off: active item sent as paused or not offered stays active, other edits land", () => {
  const prev = item({ id: "a", name_en: "Deep clean" });
  for (const status of ["paused", "not_offered"] as const) {
    const d = { ...draftFromItem(prev), name_en: "Deep clean plus", price_amount: "2500", status, status_note: "Back soon" };
    const out = save(prev, d, false);
    assert.equal(out.status, "active");
    assert.equal(out.status_note, null);
    assert.equal(out.name_en, "Deep clean plus");
    assert.equal(out.price_amount, 2500);
  }
});

test("flag off: an already-paused item keeps paused and its note when sent as not offered or a new note", () => {
  const prev = item({ id: "p", name_en: "Sofa cleaning", status: "paused", status_note: "Back next week" });
  const toNot = save(prev, { ...draftFromItem(prev), status: "not_offered", description_en: "Fabric sofas" }, false);
  assert.equal(toNot.status, "paused");
  assert.equal(toNot.status_note, "Back next week");
  assert.equal(toNot.description_en, "Fabric sofas");
  const sameNewNote = save(prev, { ...draftFromItem(prev), status_note: "Gone for good" }, false);
  assert.equal(sameNewNote.status, "paused");
  assert.equal(sameNewNote.status_note, "Back next week");
  // a plain edit (draft carries the stored state) is not a flip
  const plain = save(prev, { ...draftFromItem(prev), price_amount: "900" }, false);
  assert.equal(plain.status, "paused");
  assert.equal(plain.price_amount, 900);
});

test("flag off: not offered stays not offered when sent as paused", () => {
  const prev = item({ id: "n", name_en: "Carpet cleaning", status: "not_offered" });
  const out = save(prev, { ...draftFromItem(prev), status: "paused", status_note: "x" }, false);
  assert.equal(out.status, "not_offered");
  assert.equal(out.status_note, null);
});

test("flag off: putting a paused item back to Offered is allowed (the Status control offers it)", () => {
  const prev = item({ id: "p", name_en: "Sofa cleaning", status: "paused", status_note: "Back next week" });
  const out = save(prev, { ...draftFromItem(prev), status: "active" }, false);
  assert.equal(out.status, "active");
});

test("flag off: a new item sent as paused is saved as offered", () => {
  const d = { ...draftFromItem(null), name_en: "Window cleaning", price_amount: "150", status: "paused" as const, status_note: "Soon" };
  const out = save(null, d, false);
  assert.equal(out.status, "active");
  assert.equal(out.status_note, null);
});

test("flag on: states save as sent", () => {
  const prev = item({ id: "a", name_en: "Deep clean" });
  assert.equal(save(prev, { ...draftFromItem(prev), status: "paused", status_note: "Back soon" }, true).status, "paused");
  assert.equal(save(prev, { ...draftFromItem(prev), status: "not_offered" }, true).status, "not_offered");
});

test("saveKbItemAction gates the draft with the server flag before building the row", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "../dashboard/src/app/(desk)/settings/knowledge/actions.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function saveKbItemAction"), src.indexOf("export async function setKbFlagAction"));
  assert.match(body, /gateDraftStatus\(draft, prev, deskKbItemStates\(\)\)/);
  assert.match(body, /itemFromDraft\(gated, prev,/);
  assert.ok(!/itemFromDraft\(draft,/.test(body), "ungated draft reaches the row");
});
