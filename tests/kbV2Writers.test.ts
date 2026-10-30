// v2 KB writers (28 Oct): kb_items is the source of truth. Catalogue-row writers (onboarding, /api/tenant, website/FAQ
// import, old catalogue tab) are add-only and never change an owner's item state or hide anything; the old
// services_catalog -> kb_items sync is retired; services_offered is only the mirror's derived copy; Paste a list Replace.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  kbItemsFromLegacy, newKbItemsOnly, planLegacyImport, planTextImport, servicesOfferedFromKb, servicesTextToPaste, kbCatalogueComplete,
} from "../dashboard/src/lib/kbLegacy.ts";
import { mirrorLegacy, type KbItem, type KbCategory } from "../dashboard/src/lib/kbCore.ts";
import { formatServicesForCompiler, normalizeServicesCatalog } from "../dashboard/src/lib/servicesCatalog.ts";
import { tenantNeedsOnboarding } from "../dashboard/src/lib/onboarding.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const I = require("../src/knowledge/kb/items.js");
const PUB = require("../src/knowledge/kb/publish.js");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const fixture = (n: string) => JSON.parse(read(`tests/fixtures/kb/${n}.staging.json`));

/** The KB as kb_items rows (what the backfill wrote), with the columns the DB fills by default. */
function kbFrom(row: unknown): { items: KbItem[]; categories: KbCategory[] } {
  const m = kbItemsFromLegacy(row as { services_catalog?: unknown; product_catalog?: unknown });
  const items = m.items.map(({ category_name: _c, currency: _k, ...it }) => ({
    ...it, name_sw: null, name_sw_state: "none", name_sw_suggested: null, popular: false, delivery_fee_kes: null, status_note: null, row_version: 1,
  })) as KbItem[];
  const categories = m.categories.map((c) => ({ ...c, name_sw: null, name_sw_state: "none" })) as KbCategory[];
  return { items, categories };
}
/** In-memory kb_upsert_items (2026-10-28.2): upsert by id, every sent column overwritten; no hide (writers never ask). */
function applyUpsert(kb: KbItem[], rows: KbItem[]): KbItem[] {
  const by = new Map(kb.map((i) => [i.id, { ...i }]));
  for (const r of rows) by.set(r.id, { ...(by.get(r.id) || {}), ...r, row_version: (by.get(r.id)?.row_version || 0) + 1 } as KbItem);
  return [...by.values()];
}
const stateOf = (kb: KbItem[], id: string) => {
  const i = kb.find((x) => x.id === id)!;
  return { status: i.status, holdable: i.holdable, excludes_en: i.excludes_en, status_note: i.status_note };
};

describe("kb writers: Desk port of fromLegacy", () => {
  for (const name of ["dnd", "growtech"]) {
    it(`same rows as Voice fromLegacy on the ${name} staging fixture`, () => {
      const row = fixture(name);
      const voice = I.fromLegacy(row);
      const desk = kbItemsFromLegacy(row);
      assert.deepEqual(desk.items, voice.items);
      assert.deepEqual(desk.categories, voice.categories);
    });
  }
  it("mirror keeps each item's own id (legacy_ref names the column, not the row)", () => {
    const { items, categories } = kbFrom(fixture("dnd"));
    const m = mirrorLegacy(items, categories, fixture("dnd"));
    const ids = m.services_catalog.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(!ids.includes("services_catalog"));
    assert.deepEqual(ids.sort(), items.filter((i) => i.kind === "service").map((i) => i.id).sort());
  });
});

describe("kb writers: mirror pricing.mode stays in the old vocabulary (catalogue_price_history check)", () => {
  const mk = (id: string, o: Partial<KbItem>): KbItem => ({
    id, kind: "service", name_en: id, name_sw: null, name_sw_state: "none", name_sw_suggested: null, aliases: [], category_id: null, description_en: null,
    unit: null, price_mode: "fixed", price_amount: 100, price_min: null, price_max: null, in_stock: null, popular: false, delivery_fee_kes: null,
    needs_visit: false, holdable: false, excludes_en: null, status_note: null, status: "active", sort: 0, source: "owner", legacy_ref: null, row_version: 1, ...o,
  });
  const items = [
    mk("f", {}), mk("fr", { price_mode: "from" }), mk("r", { price_mode: "range", price_amount: null, price_min: 100, price_max: 200 }),
    mk("q", { price_mode: "quote", price_amount: null }), mk("sv", { price_mode: "site_visit", price_amount: null, needs_visit: true }),
    mk("n", { price_mode: "none", price_amount: null }), mk("fe", { price_mode: "free", price_amount: 0 }),
    mk("pq", { kind: "product", price_mode: "quote", price_amount: null }),
  ];
  const m = mirrorLegacy(items, [], { services_catalog: [], product_catalog: [] });
  it("every mirrored row has pricing.mode fixed / from / range / ask", () => {
    for (const r of [...m.services_catalog, ...m.product_catalog]) assert.ok(["fixed", "from", "range", "ask"].includes(String((r.pricing as { mode: string }).mode)), String(r.id));
  });
  it("and reads back as the same price mode", () => {
    const back = new Map(kbItemsFromLegacy(m).items.map((i) => [i.id, i.price_mode]));
    assert.deepEqual(Object.fromEntries(back), { f: "fixed", fr: "from", r: "range", q: "quote", sv: "site_visit", n: "none", fe: "free", pq: "quote" });
  });
});

describe("kb writers: no writer changes an owner's item state or hides items (Brain regression)", () => {
  const row = fixture("dnd");
  const base = kbFrom(row);
  const svc = base.items.filter((i) => i.kind === "service");
  const [a, b, c, d] = svc;
  const e = svc.slice(4).find((i) => i.price_mode === "fixed")!;
  const owner = applyUpsert(base.items, [
    { ...a, status: "paused", status_note: "Back next week" },
    { ...b, status: "not_offered" },
    { ...c, holdable: true },
    { ...d, excludes_en: "Outside windows" },
  ]);
  const before = [a, b, c, d].map((x) => stateOf(owner, x.id));
  const statesKept = (kb: KbItem[]) => {
    assert.deepEqual([a, b, c, d].map((x) => stateOf(kb, x.id)), before);
    assert.equal(kb.length >= owner.length, true);
    for (const it of owner) assert.ok(kb.find((x) => x.id === it.id), `${it.id} still there`);
    assert.equal(kb.filter((x) => x.status === "hidden").length, owner.filter((x) => x.status === "hidden").length, "nothing hidden");
  };

  it("onboarding save (the old columns, every item active) adds nothing and changes no state", () => {
    const plan = planLegacyImport({ services_catalog: row.services_catalog, product_catalog: row.product_catalog }, owner, { categories: base.categories });
    assert.equal(plan.fresh.length, 0);
    assert.equal(plan.edits.length, 0);
    statesKept(applyUpsert(owner, [...plan.fresh as KbItem[], ...plan.edits]));
  });
  it("onboarding save with a new row adds only that row", () => {
    const plan = planLegacyImport({ services_catalog: [...row.services_catalog, { name: "Fridge cleaning", price: "2500" }] }, owner, { categories: base.categories });
    assert.deepEqual(plan.fresh.map((x) => x.name_en), ["Fridge cleaning"]);
    const kb = applyUpsert(owner, plan.fresh as KbItem[]);
    statesKept(kb);
    assert.equal(kb.find((x) => x.name_en === "Fridge cleaning")!.status, "active");
  });
  it("/api/tenant save (free text naming the paused and not offered items) adds only new lines", () => {
    const text = formatServicesForCompiler(normalizeServicesCatalog(row.services_catalog), "Call before 5") + "\n- Balcony wash - 1,800";
    const plan = planTextImport(`${text.split("\n\nAdditional notes:")[0]}\n- Balcony wash - 1,800\n\nAdditional notes:\nCall before 5`, owner, "service");
    assert.deepEqual(plan.fresh.map((x) => x.name_en), ["Balcony wash"]);
    assert.equal(plan.fresh[0].price_amount, 1800);
    statesKept(applyUpsert(owner, plan.fresh as KbItem[]));
  });
  it("website/FAQ import (rows with no ids, same names) keeps every existing item as the owner set it", () => {
    const imported = [{ name: a.name_en, price: "999" }, { name: b.name_en.toUpperCase() }, { name: "Gutter cleaning", price: "4000" }];
    const plan = planLegacyImport({ services_catalog: imported }, owner, { categories: base.categories });
    assert.deepEqual(plan.fresh.map((x) => x.name_en), ["Gutter cleaning"]);
    const kb = applyUpsert(owner, plan.fresh as KbItem[]);
    statesKept(kb);
    assert.equal(kb.find((x) => x.id === a.id)!.price_amount, a.price_amount, "import never reprices an existing item");
  });
  it("old catalogue tab: a price edit reaches the item, its state does not move, the mirror's lossy mapping never writes back", () => {
    const m = mirrorLegacy(owner, base.categories, row);
    const edited = m.services_catalog.map((r) => (r.id === e.id ? { ...r, price: "7777", price_range: "KSh 7,777", pricing: { ...(r.pricing as object), amount_ksh: 7777, min_ksh: null, max_ksh: null, parsed_from: "7777", mode: "fixed" }, pricing_mode: "fixed", price_max: null } : r));
    const plan = planLegacyImport({ services_catalog: edited, product_catalog: m.product_catalog }, owner, { contentEdits: true, categories: base.categories });
    assert.deepEqual(plan.edits.map((x) => x.id), [e.id]);
    assert.equal(plan.edits[0].price_amount, 7777);
    assert.equal(plan.edits[0].status, owner.find((x) => x.id === e.id)!.status);
    assert.equal(plan.fresh.length, 0, "the not offered item is absent from the old columns and is not re-added or hidden");
    statesKept(applyUpsert(owner, plan.edits));
  });
  it("newKbItemsOnly never returns an existing id or name", () => {
    assert.deepEqual(newKbItemsOnly(owner.map((x) => ({ ...x, status: "active" as const })), owner), []);
  });
  it("Voice: the import sync is add-only (no hideMissing, never re-sends an existing item)", async () => {
    const calls: { items: unknown[]; hideMissing?: boolean; scope?: unknown }[] = [];
    const db = {
      listKbSource: async () => ({ items: owner, variants: [], categories: base.categories }),
      upsertKbItems: async (_t: string, o: { items: unknown[]; hideMissing?: boolean; scope?: unknown }) => { calls.push(o); return { upserted: o.items.length, hidden: 0 }; },
    };
    const r = await PUB.syncFromLegacy(db, "t", { services_catalog: [...row.services_catalog, { name: "Fridge cleaning", price: "2500" }] });
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].hideMissing && !calls[0].scope);
    assert.deepEqual(calls[0].items.map((x) => (x as { name_en: string }).name_en), ["Fridge cleaning"]);
    assert.equal(r.hidden, 0);
  });
  it("Voice: a save of the old columns no longer syncs them into kb_items (compile only)", () => {
    const s = read("server.js");
    const at = s.indexOf("app.post('/internal/desk/spoken-catalogue'");
    const handler = s.slice(at, s.indexOf("\napp.", at + 10));
    assert.match(handler, /scheduleKbCompileOnSave\(/);
    assert.doesNotMatch(s, /scheduleKbFromLegacy|legacyRow: data/);
  });
  it("Desk writers go through the add-only helpers and none writes services_offered itself", () => {
    const files = {
      "dashboard/src/app/onboarding/setupActions.ts": /importCatalogueToKb\(/,
      "dashboard/src/app/onboarding/actions.ts": /importCatalogueToKb\(/,
      "dashboard/src/app/(desk)/settings/actions.ts": /importCatalogueToKb\(/,
      "dashboard/src/app/api/tenant/route.ts": /addKbItemsFromText\(/,
    };
    for (const [f, re] of Object.entries(files)) {
      const src = read(f);
      assert.match(src, re, f);
      assert.doesNotMatch(src, /services_offered\s*:|patch\.services_offered\s*=/, f);
      assert.doesNotMatch(src, /kb_upsert_items|p_hide_missing/, f);
    }
    const w = read("dashboard/src/lib/kbWrite.server.ts");
    assert.doesNotMatch(w, /p_hide_missing/);
  });
});

describe("kb writers: services_offered is derived from the KB", () => {
  const row = fixture("dnd");
  const base = kbFrom(row);
  const [a, b] = base.items;
  const kb = applyUpsert(base.items, [{ ...a, status: "paused" }, { ...b, status: "not_offered" }]);
  it("lists offered items only and keeps the owner's notes", () => {
    const text = servicesOfferedFromKb(kb, base.categories, "Services:\n- x\n\nAdditional notes:\nWe bring our own soap");
    assert.match(text, /^Services:\n/);
    assert.ok(!text.includes(`- ${a.name_en} `) && !text.includes(`- ${b.name_en} `));
    assert.match(text, /Additional notes:\nWe bring our own soap$/);
  });
  it("the old free text splits to one item per line", () => {
    assert.equal(servicesTextToPaste("Services:\n- Deep clean - category Home - price KSh 6,000 - notes x\n\nSocial & web:\n- ig\n\nAdditional notes:\nhi"), "Deep clean - KSh 6,000");
  });
});

describe("kb writers: completion check counts active kb_items", () => {
  it("legacy check: a catalogue means at least one active item, not services_offered", () => {
    assert.equal(kbCatalogueComplete(0), false);
    assert.equal(kbCatalogueComplete(3), true);
    const t = { business_name: "X", llm_system_prompt: "", business_hours: "Mon 9-5", agent_tone: "warm" };
    assert.equal(tenantNeedsOnboarding({ ...t, kb_active_items: 2 }), false);
    assert.equal(tenantNeedsOnboarding({ ...t, kb_active_items: 0 }), true);
    assert.equal(tenantNeedsOnboarding({ ...t, setup_completed_at: "2026-10-28T08:00:00Z" }), false);
  });
});

describe("kb writers: Paste a list Replace (2026-10-28.3)", () => {
  const sql = read("docs/supabase/kb_v2_paste_replace.sql");
  it("one function: upsert, then soft-remove that kind's missing rows; conflict or empty Replace rolls back", () => {
    assert.match(sql, /create or replace function public\.kb_import_items\(p_tenant uuid, p_kind text, p_items jsonb, p_replace boolean default false\)/);
    assert.match(sql, /set status = 'hidden'[\s\S]*k\.kind = p_kind and k\.status <> 'hidden'/);
    assert.match(sql, /raise exception 'kb_import_items: conflict/);
    assert.match(sql, /replace needs at least one item/);
    assert.match(sql, /grant execute on function public\.kb_import_items\(uuid, text, jsonb, boolean\) to service_role/);
    assert.match(read("docs/supabase/kb_v2_paste_replace_down.sql"), /drop function if exists public\.kb_import_items/);
  });
  it("the action keeps append as the default and sends Replace through kb_import_items", () => {
    const a = read("dashboard/src/app/(desk)/settings/knowledge/actions.ts");
    assert.match(a, /importKbPasteAction\(rows: KbPasteRow\[\], kind: KbKind, group: string, mode: "append" \| "replace" = "append"\)/);
    assert.match(a, /mode === "replace" \? \{ replaceKind: k \} : \{\}/);
    assert.match(read("dashboard/src/lib/kbWrite.server.ts"), /rpc\("kb_import_items", \{ p_tenant: tenantId, p_kind: opts\.replaceKind, p_items: clean, p_replace: true \}\)/);
  });
});
