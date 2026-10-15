import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as m from "../dashboard/src/lib/providerHealthModel.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const NOW = Date.parse("2026-10-15T05:00:00Z");
const fresh = new Date(NOW - 5 * 60_000).toISOString();
const ALL_SCOPES = ["wallet.read", "numbers.read", "calls.read", "recordings.read", "whatsapp.messages"];

function payload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    checkedAt: new Date(NOW).toISOString(),
    telephony: { configured: true, lastError: { billingExhausted: false, balanceMinor: 250000, currency: "KES", message: "ok", at: fresh } },
    keyScopes: { sautikit: { configured: true, checks: ALL_SCOPES.map((scope) => ({ scope, ok: true })) } },
    soniox: { stt: true, tts: true, lastError: { stt: null, tts: null, billingExhausted: false } },
    sonioxBalance: { configured: true, state: "ok", balanceUsd: 80, autopay: true, checkedAt: fresh, error: null },
    gemini: { configured: true, lastError: { lastError: null, billingExhausted: false, denied: false } },
    sms: { configured: true, verified: true, balance: 900, checkedAt: fresh, state: "ok", runwayDays: 24 },
    notify: { whatsapp: true, email: true },
    ...over,
  };
}
const ok = (p = payload()) => ({ status: "ok" as const, payload: p as never });

test("all green: banner says calls go through, Aris pinned, no fixes", () => {
  const cards = m.buildProviderCards("prod", ok(), { supabaseOk: true, now: NOW });
  assert.ok(cards.every((c) => c.state === "ok"), JSON.stringify(cards.filter((c) => c.state !== "ok")));
  const banner = m.computeBanner(cards, { e164: m.PINNED_DID, business: "Aris Kenya", status: "assigned" });
  assert.equal(banner.state, "ok");
  assert.equal(banner.headline, "Calls go through");
  assert.equal(banner.pinned?.e164, "+254709221536");
  assert.deepEqual(m.buildFixList(cards), []);
});

test("empty phone wallet means calls are not going through, owner Alvin", () => {
  const p = payload({ telephony: { configured: true, lastError: { billingExhausted: true, balanceMinor: 0, currency: "KES", message: "telephony wallet empty", at: fresh } } });
  const cards = m.buildProviderCards("prod", ok(p), { now: NOW });
  const banner = m.computeBanner(cards, null);
  assert.equal(banner.state, "down");
  assert.equal(banner.headline, "Calls are not going through");
  assert.equal(banner.owner, "Alvin");
});

test("SMS / WhatsApp / email never drive the banner", () => {
  const p = payload({ sms: { configured: true, state: "exhausted", balance: 0, checkedAt: fresh }, notify: { whatsapp: true, email: false } });
  const cards = m.buildProviderCards("prod", ok(p), { now: NOW });
  assert.equal(cards.find((c) => c.id === "textsms")?.state, "down");
  assert.equal(m.computeBanner(cards, null).state, "ok");
});

test("Soniox autopay off counts as at risk (degraded)", () => {
  const p = payload({ sonioxBalance: { configured: true, state: "warn", balanceUsd: 80, autopay: false, checkedAt: fresh, error: "Soniox autopay is off." } });
  const card = m.buildProviderCards("prod", ok(p), { now: NOW }).find((c) => c.id === "soniox")!;
  assert.equal(card.state, "degraded");
  assert.match(card.balance, /autopay off/);
});

test("stale checks show as Unknown", () => {
  const old = new Date(NOW - 5 * 3_600_000).toISOString();
  const p = payload({ sms: { configured: true, state: "ok", balance: 900, checkedAt: old } });
  const card = m.buildProviderCards("prod", ok(p), { now: NOW }).find((c) => c.id === "textsms")!;
  assert.equal(card.state, "unknown");
  assert.match(card.error || "", /stale/);
});

test("missing whatsapp.messages scope is Down on the WhatsApp card; scopes sit in the SautiKit card", () => {
  const p = payload({
    keyScopes: { sautikit: { configured: true, checks: ALL_SCOPES.map((scope) => ({ scope, ok: scope !== "whatsapp.messages" })) } },
  });
  const cards = m.buildProviderCards("staging", ok(p), { now: NOW });
  assert.equal(cards.find((c) => c.id === "whatsapp")?.state, "down");
  assert.equal(cards.find((c) => c.id === "sautikit")?.scopes?.length, 5);
});

test("Gemini, Resend, Supabase say Balance unknown; TextSMS is shared", () => {
  const cards = m.buildProviderCards("prod", ok(), { supabaseOk: true, now: NOW });
  for (const id of ["gemini", "resend", "supabase"]) {
    assert.equal(cards.find((c) => c.id === id)?.balance, "Balance unknown", id);
  }
  assert.equal(cards.find((c) => c.id === "textsms")?.shared, true);
});

test("fix list ranks call-carrying + prod first and lists a shared account once", () => {
  const smsOut = { sms: { configured: true, state: "exhausted", balance: 0, checkedAt: fresh } };
  const prod = m.buildProviderCards("prod", ok(payload(smsOut)), { now: NOW });
  const staging = m.buildProviderCards(
    "staging",
    ok(payload({ ...smsOut, gemini: { configured: true, lastError: { lastError: null, billingExhausted: true } } })),
    { now: NOW },
  );
  const list = m.buildFixList([...prod, ...staging]);
  assert.equal(list[0].key, "staging:gemini");
  assert.equal(list.filter((i) => i.key.endsWith(":textsms")).length, 1);
});

test("unreachable Voice is a Down voice card", () => {
  const cards = m.buildProviderCards("prod", { status: "unreachable", message: "Voice refused the admin health token" }, { now: NOW });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].state, "down");
  assert.equal(m.computeBanner(cards, null).headline, "Calls are not going through");
});

test("relative time + EAT absolute", () => {
  assert.equal(m.relativeTime(fresh, NOW), "5 min ago");
  assert.match(m.absoluteEat(fresh), /EAT$/);
  assert.equal(m.answeredPct(10, 2), 80);
  assert.equal(m.answeredPct(0, 0), null);
});

test("page wiring: sections in order, links only, business not tenant, SMS panel moved", () => {
  const page = read("dashboard/src/app/admin/(console)/platform/page.tsx");
  const order = ["<HeaderSection", "<BannerSection", "<StatsSection", "<FixSection", "<ProvidersSection", "<LinesSection", "<HostingSection", "<OpsFormSection"];
  const idx = order.map((s) => page.indexOf(s));
  assert.ok(idx.every((i, k) => i > 0 && (k === 0 || i > idx[k - 1])), String(idx));
  const ui = ["PlatformSections.tsx", "ProviderCards.tsx", "ProviderDetail.tsx", "HealthStamp.tsx"]
    .map((f) => read(`dashboard/src/components/platform/${f}`))
    .join("\n");
  assert.doesNotMatch(ui, /tenant/i);
  assert.doesNotMatch(ui, /<form|action=|method="post"/i);
  assert.doesNotMatch(ui, /#[0-9a-fA-F]{6}\b/);
  assert.doesNotMatch(read("dashboard/src/app/admin/(console)/billing/page.tsx"), /SmsCreditPanel/);
  assert.match(read("dashboard/src/lib/platformVoiceHealth.ts"), /\/admin\/health/);
});

test("balance splits into a large figure and a clear unit", () => {
  assert.deepEqual(m.splitBalance("KES 2,500"), { balanceAmount: "2,500", balanceUnit: "KES" });
  assert.deepEqual(m.splitBalance("900 units"), { balanceAmount: "900", balanceUnit: "units" });
  assert.deepEqual(m.splitBalance("USD 80 · autopay off"), { balanceAmount: "80", balanceUnit: "USD · autopay off" });
  assert.deepEqual(m.splitBalance("Balance unknown"), { balanceAmount: null, balanceUnit: null });
});
