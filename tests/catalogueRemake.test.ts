// Settings > Catalogue remake (KB v2, staging): price words, no faked "no price", item states, paste preview.
// Run: node --experimental-strip-types --no-warnings --import ./tests/registerTs.mjs --test tests/catalogueRemake.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { draftFromItem, itemFromDraft, parsePasteList, type KbItem } from "../dashboard/src/lib/kbCore.ts";
import {
  PRICE_CHOICES,
  catalogueCounts,
  editDraft,
  filterItems,
  isUnpriced,
  itemState,
  newDraft,
  nextUnpriced,
  pasteRowLine,
  pasteSummary,
  pasteSummaryLine,
  priceInWords,
  rowTags,
  savedLine,
  savesInstantly,
  sheetErrors,
  statusLine,
  withAmount,
  withChoice,
} from "../dashboard/src/lib/catalogueView.ts";

const item = (o: Partial<KbItem> & { id: string; name_en: string }): KbItem => ({
  kind: "service", name_sw: null, name_sw_state: "none", name_sw_suggested: null, aliases: [], category_id: null, description_en: null,
  unit: null, price_mode: "none", price_amount: null, price_min: null, price_max: null, in_stock: null, popular: false, delivery_fee_kes: null,
  needs_visit: false, holdable: false, excludes_en: null, status_note: null, status: "active", sort: 0, source: "owner", legacy_ref: null, row_version: 1, ...o,
});

test("price-type mapping: every contract price mode reads in words, with no dashes", () => {
  const cases: [Partial<KbItem>, string][] = [
    [{ price_mode: "fixed", price_amount: 2500 }, "KSh 2,500"],
    [{ price_mode: "fixed", price_amount: 3000, unit: "job" }, "KSh 3,000 per job"],
    [{ price_mode: "from", price_amount: 4000 }, "From KSh 4,000"],
    [{ price_mode: "range", price_min: 3000, price_max: 6000, unit: "job" }, "KSh 3,000 to 6,000 per job"],
    [{ price_mode: "per_unit", price_amount: 800, unit: "seat" }, "KSh 800 per seat"],
    [{ price_mode: "quote" }, "Custom quote"],
    [{ price_mode: "site_visit" }, "Quote after a site visit"],
    [{ price_mode: "free", price_amount: 0 }, "Free"],
    [{ price_mode: "none" }, "Needs a price"],
    [{ price_mode: "fixed", price_amount: null }, "Needs a price"],
    [{ price_mode: "range", price_min: 100, price_max: null }, "Needs a price"],
  ];
  for (const [o, want] of cases) {
    const got = priceInWords(item({ id: "x", name_en: "X", ...o }));
    assert.equal(got, want);
    assert.doesNotMatch(got, /[–—]/);
  }
});

test("price choices: one Custom quote (no Ask / Quote split), every contract mode except none, and instant save only for no-number choices", () => {
  const keys = PRICE_CHOICES.map((c) => c.key).sort();
  assert.deepEqual(keys, ["fixed", "free", "from", "per_unit", "quote", "range", "site_visit"]);
  assert.equal(PRICE_CHOICES.filter((c) => /quote|ask/i.test(c.label)).map((c) => c.label).join("|"), "Custom quote");
  assert.ok(savesInstantly("quote") && savesInstantly("site_visit") && savesInstantly("free"));
  assert.ok(!savesInstantly("fixed") && !savesInstantly("range") && !savesInstantly("per_unit") && !savesInstantly("from"));
});

test("no price type is preselected, so a Save can't fake the 'no price' count", () => {
  const d = newDraft("service", []);
  assert.equal(d.price_mode, "none");
  // A legacy "fixed with no amount" row also opens with nothing picked.
  const e = editDraft(item({ id: "svc_1", name_en: "Office cleaning", price_mode: "fixed", price_amount: null }), []);
  assert.equal(e.price_mode, "none");
  // Saving the untouched draft keeps it unpriced (contract itemFromDraft).
  const saved = itemFromDraft({ ...e, name_en: "Office cleaning" }, null, null);
  assert.equal(saved.price_mode, "none");
  assert.ok(isUnpriced(saved));
  assert.equal(savedLine(e), "Saved. It still needs a price.");
  // Contract helper on its own would have preselected One price for a new item; the Desk draft must not.
  assert.equal(draftFromItem(null, []).price_mode, "fixed");
});

test("typing an amount means One price; clearing it goes back to no price; choices carry numbers", () => {
  let d = newDraft("service", []);
  d = withAmount(d, "3,000");
  assert.equal(d.price_mode, "fixed");
  d = withAmount(d, "");
  assert.equal(d.price_mode, "none");
  d = withChoice(withAmount(d, "2000"), "range");
  assert.equal(d.price_min, "2000");
  assert.equal(d.price_mode, "range");
  const pu = withChoice({ ...newDraft("service", []), name_en: "Sofa" }, "per_unit");
  assert.ok(sheetErrors({ ...pu, price_amount: "800" }).some((e) => /per/.test(e)));
  assert.deepEqual(sheetErrors({ ...pu, price_amount: "800", unit: "seat" }), []);
  assert.deepEqual(sheetErrors({ ...withChoice({ ...newDraft("service", []), name_en: "Carpet" }, "quote") }), []);
});

test("states: paused (with note), not offered, hold and not included are separate from delete", () => {
  const paused = item({ id: "a", name_en: "After builders", status: "paused", status_note: "back in January", price_mode: "site_visit" });
  const no = item({ id: "b", name_en: "Pest control", status: "not_offered" });
  const oos = item({ id: "c", name_en: "Atlas", kind: "product", in_stock: false, price_mode: "fixed", price_amount: 900 });
  assert.equal(itemState(paused), "paused");
  assert.equal(itemState(no), "not_offered");
  assert.deepEqual(rowTags(paused), ["Paused: back in January"]);
  assert.deepEqual(rowTags(no), ["Not offered"]);
  assert.deepEqual(rowTags(oos), ["Out of stock"]);
  // Not offered is a "no", not something to price; paused still counts.
  const c = catalogueCounts([paused, no, item({ id: "d", name_en: "Window" })]);
  assert.equal(c.needPrice, 1);
  assert.equal(c.notOffered, 1);
  assert.equal(c.paused, 1);
  // Draft round trip through the contract keeps the state and note; note dropped when not paused.
  const pd = itemFromDraft(draftFromItem(paused, []), paused, null);
  assert.equal(pd.status, "paused");
  assert.equal(pd.status_note, "back in January");
  const nd = itemFromDraft({ ...draftFromItem(paused, []), status: "not_offered" }, paused, null);
  assert.equal(nd.status_note, null);
  const held = itemFromDraft({ ...draftFromItem(oos, []), holdable: true }, oos, null);
  assert.equal(held.holdable, true);
  const ex = itemFromDraft({ ...draftFromItem(item({ id: "e", name_en: "Deep clean", price_mode: "fixed", price_amount: 1 }), []), excludes_en: "Outside windows" }, null, null);
  assert.equal(ex.excludes_en, "Outside windows");
  assert.equal(ex.status, "active");
});

test("status line and Fix walk through items without a price", () => {
  const items = [
    item({ id: "1", name_en: "Deep clean", price_mode: "fixed", price_amount: 6000 }),
    item({ id: "2", name_en: "Office" }),
    item({ id: "3", name_en: "Window" }),
    item({ id: "4", name_en: "Pest", status: "not_offered" }),
  ];
  assert.equal(statusLine(catalogueCounts(items)), "4 services · 2 need a price");
  assert.equal(statusLine(catalogueCounts([items[0]])), "1 service · all priced");
  assert.equal(statusLine(catalogueCounts([])), "Nothing added yet");
  assert.equal(nextUnpriced(items)?.id, "2");
  assert.equal(nextUnpriced(items, "2")?.id, "3");
  assert.equal(nextUnpriced(items, "3")?.id, "2");
  assert.equal(nextUnpriced([items[0], items[1]], "2"), null);
});

test("Add prices filter has a way out and search matches names, other names and groups", () => {
  const items = [
    item({ id: "1", name_en: "Sofa cleaning", aliases: ["couch"], category_id: "up", price_mode: "fixed", price_amount: 1 }),
    item({ id: "2", name_en: "Office cleaning" }),
    item({ id: "3", name_en: "Atlas", kind: "product" }),
  ];
  const cats = [{ id: "up", name_en: "Upholstery", name_sw: null, name_sw_state: "none" as const, sort: 1 }];
  assert.deepEqual(filterItems(items, cats, { query: "", kind: "all", needPrice: true }).map((i) => i.id), ["2", "3"]);
  assert.deepEqual(filterItems(items, cats, { query: "couch", kind: "all", needPrice: false }).map((i) => i.id), ["1"]);
  assert.deepEqual(filterItems(items, cats, { query: "uphol", kind: "all", needPrice: false }).map((i) => i.id), ["1"]);
  assert.deepEqual(filterItems(items, cats, { query: "", kind: "product", needPrice: false }).map((i) => i.id), ["3"]);
  const src = fs.readFileSync(path.join(import.meta.dirname, "../dashboard/src/components/catalogue/CatalogueScreen.tsx"), "utf8");
  assert.match(src, /data-need-price-banner/);
  assert.match(src, /Show all/);
  const slots = fs.readFileSync(path.join(import.meta.dirname, "../dashboard/src/components/structured/StructuredSettingsSlots.tsx"), "utf8");
  assert.match(slots, /UNPRICED_HREF = "\/settings\/knowledge\?filter=unpriced"/);
});

test("paste preview: words per row, new vs update vs skipped, 500 cap", () => {
  const existing = [{ id: "svc_deep", name_en: "Deep clean" }];
  const rows = parsePasteList(["Deep clean, 6,000 to 12,000", "Carpet cleaning: quote", "Move out clean - site visit", "Sofa cleaning 800 per seat", "Office cleaning", "Office cleaning"].join("\n"), existing);
  assert.equal(pasteRowLine(rows[0]), "KSh 6,000 to 12,000 · updates the item you have");
  assert.equal(pasteRowLine(rows[1]), "Custom quote");
  assert.equal(pasteRowLine(rows[2]), "Quote after a site visit");
  assert.equal(pasteRowLine(rows[3]), "KSh 800 per seat");
  assert.equal(pasteRowLine(rows[4]), "Needs a price");
  assert.equal(pasteRowLine(rows[5]), "Same name as a line above.");
  const s = pasteSummary(rows);
  assert.equal(s.adds, 4);
  assert.equal(s.updates, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.needPrice, 1);
  assert.equal(s.ready.length, 5);
  assert.equal(pasteSummaryLine(s), "4 new · 1 updates an item you have · 1 needs a price · 1 skipped");
  const big = parsePasteList(Array.from({ length: 502 }, (_, i) => `Item ${i + 1}, ${100 + i}`).join("\n"));
  const bs = pasteSummary(big);
  assert.equal(bs.ready.length, 500);
  assert.equal(bs.skipped, 2);
});

test("Catalogue copy: no em or en dashes, no tenant or shop", () => {
  for (const f of ["components/catalogue/CatalogueScreen.tsx", "lib/catalogueView.ts"]) {
    const src = fs.readFileSync(path.join(import.meta.dirname, "../dashboard/src", f), "utf8");
    const strings = [...src.matchAll(/"([^"\n]{3,})"|`([^`\n]{3,})`|>([^<>{}\n]{3,})</g)].map((m) => m[1] || m[2] || m[3]).filter((s) => /[A-Za-z]{3}/.test(s) && !/^[a-z-:/[\]@.()\s0-9]+$/.test(s));
    for (const s of strings) {
      assert.doesNotMatch(s, /[–—]/, `${f}: ${s}`);
      assert.doesNotMatch(s, /\btenant\b|\bshop\b/i, `${f}: ${s}`);
    }
  }
});
