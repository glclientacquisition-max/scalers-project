import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as sd from "../dashboard/src/lib/structuredData.ts";
import { catalogueForTenant } from "../dashboard/src/lib/setupFlow.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const MIGRATION = read("supabase/migrations/20261011200000_structured_data_foundation.sql");

test("taxonomy: dashboard copy is byte-identical to src/data (one taxonomy)", () => {
  assert.equal(read("dashboard/src/lib/taxonomy.json"), read("src/data/taxonomy.json"));
});

test("taxonomy: SQL CHECK lists match the taxonomy ids", () => {
  const sqlList = (col: string) => {
    const m = MIGRATION.match(new RegExp(`${col} text check \\(${col} is null or ${col} in \\(([^)]*)\\)`, "s"));
    assert.ok(m, `check for ${col}`);
    return m[1].match(/'([a-z_]+)'/g)!.map((s) => s.replace(/'/g, "")).sort();
  };
  const ids = (l: { id: string }[]) => l.map((o) => o.id).sort();
  assert.deepEqual(sqlList("intent"), ids(sd.INTENTS));
  assert.deepEqual(sqlList("outcome"), ids(sd.OUTCOMES));
  assert.deepEqual(sqlList("lost_reason"), ids(sd.LOST_REASONS));
  const V2 = read("supabase/migrations/20261012090000_payments_policies_v2.sql");
  for (const m of sd.PAYMENT_METHODS) assert.ok(V2.includes(`'${m.id}'`), m.id);
});

test("legacy intents all map into the taxonomy", () => {
  for (const [, to] of Object.entries(sd.TAXONOMY.legacy_intents)) assert.ok(sd.isIntent(to), to);
  assert.equal(sd.canonicalIntent("order_enquiry"), "order_status");
  assert.equal(sd.canonicalIntent("hours_open"), "hours");
  assert.equal(sd.canonicalIntent("made_up"), "other");
  assert.equal(sd.canonicalIntent(""), null);
});

test("parsePriceText reads Kenyan price text", () => {
  const p = sd.parsePriceText;
  assert.deepEqual([p("2,500").mode, p("2,500").amount_ksh], ["fixed", 2500]);
  assert.equal(p("KSh 1,200/=").amount_ksh, 1200);
  assert.deepEqual([p("From 2,500 KES").mode, p("From 2,500 KES").amount_ksh], ["from", 2500]);
  const r = p("KSh 1,000 - 2,000 per visit");
  assert.deepEqual([r.mode, r.min_ksh, r.max_ksh, r.unit], ["range", 1000, 2000, "visit"]);
  assert.equal(p("500 per kg").unit, "kg");
  assert.equal(p("2.5k").amount_ksh, 2500);
  assert.equal(p("depends on size").mode, "ask");
  assert.equal(p("").mode, "ask");
  assert.equal(p("3000-1000").mode, "fixed"); // inverted range is not a range
});

test("(0) setup stores numeric price fields, not only text", () => {
  const shop = catalogueForTenant({ skipped: false, rows: [{ name: "A4 ream", pricing_mode: "fixed", price: "650", price_max: "", category: "", notes: "", site_visit: "" }] } as never, "retail");
  const pr = (shop.products[0] as { pricing: sd.StructuredPrice }).pricing;
  assert.deepEqual([pr.mode, pr.amount_ksh, pr.source, pr.confirmed], ["fixed", 650, "owner", true]);
  const home = catalogueForTenant({ skipped: false, rows: [{ name: "Deep clean", pricing_mode: "range", price: "3000", price_max: "6000", category: "", notes: "", site_visit: "no" }] } as never, "home_services");
  const hp = (home.services[0] as { pricing: sd.StructuredPrice }).pricing;
  assert.deepEqual([hp.mode, hp.min_ksh, hp.max_ksh, hp.unit], ["range", 3000, 6000, "job"]);
  const ask = sd.priceFromSetup({ pricing_mode: "fixed", price: "" });
  assert.equal(ask.mode, "ask");
});

test("syncPricing keeps confirmed prices when text is unchanged, re-reads edited text", () => {
  const stored = { ...sd.priceFromSetup({ pricing_mode: "fixed", price: "650" }), parsed_from: "KSh 650" };
  const same = sd.syncPricing({ pricing: stored }, "KSh 650", "yes");
  assert.equal(same.confirmed, true);
  assert.equal(same.in_stock, true);
  const edited = sd.syncPricing({ pricing: stored }, "KSh 700", "");
  assert.deepEqual([edited.amount_ksh, edited.source, edited.confirmed], [700, "owner", true]);
  const vague = sd.syncPricing({}, "depends on size", "");
  assert.deepEqual([vague.mode, vague.confirmed], ["ask", false]);
  assert.equal(sd.sanitizePricing({ mode: "weird" }), null);
  assert.equal(sd.sanitizePricing({ mode: "fixed", amount_ksh: -5 })!.amount_ksh, null);
});

test("priceLabel derives display text from typed fields", () => {
  assert.equal(sd.priceLabel({ mode: "fixed", amount_ksh: 2500, min_ksh: null, max_ksh: null, unit: null }), "KSh 2,500");
  assert.equal(sd.priceLabel({ mode: "from", amount_ksh: 800, min_ksh: 800, max_ksh: null, unit: "hour" }), "From KSh 800 per hour");
  assert.equal(sd.priceLabel({ mode: "ask", amount_ksh: null, min_ksh: null, max_ksh: null, unit: null }), "Ask");
});

test("payments: parse prose, validate till/paybill/deposit", () => {
  const p = sd.parsePaymentsText("M-Pesa till 123456, cash on delivery", "30% deposit")!;
  assert.deepEqual(p.methods, ["mpesa_till", "cash"]);
  assert.equal(p.mpesa_till, "123456");
  assert.equal(p.deposit_percent, 30);
  assert.deepEqual(p.timings, ["on_delivery", "deposit_then_balance"]);
  assert.equal(p.source, "parsed");
  assert.equal(sd.parsePaymentsText("Paybill 247247 account 0712345")!.mpesa_paybill!.account, "0712345");
  assert.equal(sd.parsePaymentsText("we are friendly"), null);
  const bad = { ...sd.emptyPayments(), methods: ["mpesa_till", "mpesa_paybill"] as sd.PaymentMethod[], mpesa_till: "12", mpesa_paybill: { business_no: "abc", account_mode: "fixed" as const, account: null }, timings: ["deposit_then_balance"] as sd.PaymentTiming[], deposit_percent: 150 };
  const e = sd.validatePayments(bad);
  assert.ok(e.mpesa_till && e.paybill && e.paybill_account && e.deposit_percent);
  const ok = sd.cleanPayments({ ...sd.emptyPayments(), methods: ["cash", "mpesa_till"], mpesa_till: "123 456", mpesa_paybill: { business_no: "1", account_mode: "fixed", account: null } });
  assert.deepEqual(ok.methods, ["mpesa_till", "cash"]);
  assert.equal(ok.mpesa_till, "123456");
  assert.equal(ok.mpesa_paybill, null);
  assert.deepEqual(sd.validatePayments(ok), {});
  assert.equal(sd.paymentsSentence(ok), "You can pay by M-Pesa Buy Goods Till 123456 or cash.");
});

test("timeOfDay uses Nairobi time", () => {
  assert.equal(sd.timeOfDay("2026-10-11T20:00:00Z"), "evening"); // 23:00 EAT
  assert.equal(sd.timeOfDay("2026-10-11T05:00:00Z"), "morning"); // 08:00 EAT
  assert.equal(sd.timeOfDay("2026-10-11T23:30:00Z"), "night"); // 02:30 EAT
});

test("categories come from the taxonomy per business type", () => {
  assert.ok(sd.categoriesFor("retail").some((c) => c.id === "books_stationery"));
  assert.ok(sd.categoriesFor("home_services").some((c) => c.id === "cleaning"));
  assert.deepEqual(sd.categoriesFor("nope"), []);
  for (const b of sd.BUSINESS_TYPES) for (const c of b.categories) assert.match(c.id, /^[a-z_]{2,40}$/); // matches SQL check
});

test("UI copy: says Business Assistant, chips not free text, Sheet for edits", () => {
  const dir = path.join(root, "dashboard/src/components/structured");
  const all = fs.readdirSync(dir).map((f) => read(`dashboard/src/components/structured/${f}`)).join("\n");
  assert.doesNotMatch(all, /receptionist|AI assistant/i);
  assert.match(all, /Business Assistant/);
  assert.match(all, /from "@\/components\/ui\/Sheet"/);
  assert.doesNotMatch(all, /<textarea|<select/);
  assert.doesNotMatch(all, /transition-all|text-\[\d|#[0-9a-f]{6}/i);
});

test("prices: no price text is 'Add prices', never an 'Is this right?' card", () => {
  const empty = { mode: "ask", amount_ksh: null, min_ksh: null, max_ksh: null, unit: null, in_stock: null, source: "parsed", confirmed: false } as never;
  assert.equal(sd.needsPriceConfirm({ pricing: empty, text: "" }), false);
  assert.equal(sd.isUnpriced({ pricing: empty, text: "" }), true);
  assert.equal(sd.isUnpriced({ pricing: null, text: "" }), true);
  // Ambiguous text is still a check, not "no price".
  const vague = { ...(empty as object), parsed_from: "Varies by item" } as never;
  assert.equal(sd.needsPriceConfirm({ pricing: vague, text: "Varies by item" }), true);
  assert.equal(sd.isUnpriced({ pricing: vague, text: "Varies by item" }), false);
  const parsed = { ...(empty as object), mode: "fixed", amount_ksh: 200, parsed_from: "KSh 200" } as never;
  assert.equal(sd.needsPriceConfirm({ pricing: parsed, text: "KSh 200" }), true);
  const owner = { ...(empty as object), source: "owner", confirmed: true } as never;
  assert.equal(sd.isUnpriced({ pricing: owner, text: "" }), false);
  assert.equal(sd.needsPriceConfirm({ pricing: owner, text: "" }), false);
});

test("prices: Overview shows one 'Add prices' row that opens the filtered catalogue", () => {
  const slots = read("dashboard/src/components/structured/StructuredSettingsSlots.tsx");
  assert.match(slots, /UNPRICED_HREF = `\$\{businessSettingsHref\("train", "catalog"\)\}&filter=unpriced`/);
  assert.match(slots, /if \(unpriced\) out\.push\(\{ href: UNPRICED_HREF, label: unpricedLabelText\(unpriced\)/);
  assert.match(read("dashboard/src/components/structured/unpricedCopy.ts"), /no price/);
  const form = read("dashboard/src/components/TenantForm.tsx");
  assert.match(form, /get\("filter"\) === "unpriced"/);
  assert.match(form, /productIdx\[safeProductPage \* PRODUCT_PAGE_SIZE \+ localIndex\]/);
  assert.match(MIGRATION, /coalesce\(btrim\(i->'pricing'->>'parsed_from'\), ''\) <> ''\)::int,/);
});
