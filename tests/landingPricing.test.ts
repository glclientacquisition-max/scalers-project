// Landing P0-1 (30 Oct): pricing from billing_packages, Beta program featured, plan carried into Request access.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { accessPlanFromParam, withPlanPrefix } from "../dashboard/src/lib/accessPlan.ts";
import { parseAccessRequestForm } from "../dashboard/src/lib/accessRequestLogic.ts";

const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "dashboard/src", p), "utf8");

test("plan param is cleaned; unknown shapes are dropped", () => {
  assert.equal(accessPlanFromParam("Beta"), "beta");
  assert.equal(accessPlanFromParam(["growth", "x"]), "growth");
  assert.equal(accessPlanFromParam("<script>"), null);
  assert.equal(accessPlanFromParam(undefined), null);
  assert.equal(withPlanPrefix("We clean homes", "beta"), "[Plan: Beta program] We clean homes");
  assert.equal(withPlanPrefix("We clean homes", null), "We clean homes");
});

test("Request access stores the picked plan at the front of about", () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: "Jane", business_name: "Jirani", email: "j@x.co", phone: "0712345678", about: "Cleaning", plan: "starter" })) fd.set(k, v);
  const r = parseAccessRequestForm(fd);
  assert.ok(r.ok);
  assert.equal(r.ok && r.fields.about, "[Plan: Starter] Cleaning");
});

test("three paid plans, Growth recommended, no Beta card, no hard-coded price", () => {
  const ui = read("components/marketing/PackagePrices.tsx");
  const page = read("app/pricing/page.tsx");
  assert.match(ui, /Recommended/);
  assert.doesNotMatch(ui, /Most popular|BETA_PLAN|Beta program|Featured/);
  assert.match(ui, /encodeURIComponent\(pack\.sku\)/);
  assert.match(ui, /Message credits/);
  assert.doesNotMatch(ui, /staffWa|"SMS"|"Email"|"WhatsApp"/);
  assert.match(page, /Pick your monthly call minutes/);
  assert.doesNotMatch(ui + page, /\bfree\b|\btrial\b|coming soon|\bvat\b/i);
  assert.doesNotMatch(ui + page, /KES \d|KSh \d|\d{1,3},\d{3}/);
  assert.match(read("app/signup/page.tsx"), /<RequestAccessForm plan=\{plan\} \/>/);
  assert.match(read("app/signup/page.tsx"), /<PlanRequestForm searchParams=\{searchParams\} \/>/);
});

test("pricing v2: at most 3 live packages, rates and the worked example from the live board, true FAQ only", async () => {
  const ui = read("components/marketing/PackagePrices.tsx") + read("components/marketing/pricingMath.ts");
  assert.match(ui, /MAX_PUBLIC_PACKAGES = 3/);
  assert.match(ui, /\.slice\(0, MAX_PUBLIC_PACKAGES\)/);
  assert.doesNotMatch(ui, /landing-orbs|data-pricing-orbs/);
  const page = read("app/pricing/page.tsx");
  assert.match(page, /data-pricing-hero=/);
  assert.match(page, /data-pricing-fade=/);
  assert.match(page, /to-canvas/);
  assert.match(page, /from-brand-900 via-brand-800\/95 to-brand-700\/80/);
  assert.doesNotMatch(page, /landing-warm|landing-horizon|--landing-warm/);
  const dockAt = ui.indexOf("data-pricing-dock");
  const dock = ui.slice(Math.max(0, dockAt - 280), dockAt + 420);
  assert.match(dock, /flex items-center/);
  assert.match(dock, /size="md"/);
  assert.doesNotMatch(dock, /backdrop-blur|pt-4|mb-2/);
  assert.match(ui, /Annual/);
  assert.match(ui, /data-pricing-cycle/);
  assert.doesNotMatch(ui + page, /wallet|top.?up|m-?pesa|\bvat\b/i);
  const catalog = read("lib/packageCatalog.ts");
  const loader = catalog.slice(catalog.indexOf("export async function loadPublicPackageOffers"));
  assert.match(catalog, /billing_package_versions/);
  assert.match(catalog, /publishedPublicOffers/);
  assert.match(loader, /annual_price_kes/);
  assert.match(loader, /annual_discount_percent/);
  assert.match(loader, /message_credits/);
  assert.doesNotMatch(loader, /annualPriceKes\(monthlyPriceKes, discount\)/);
  assert.match(ui, /pack\.inboundKesPerMinute/);
  assert.doesNotMatch(ui, /Answered calls/);
  const { workedExample, pricingFaq, plansForPage, perDayKes, perDayMinutes, creditUseLine } = await import(
    "../dashboard/src/components/marketing/pricingMath.ts"
  );
  const { publishedInboundPerMinute, publishedPublicOffers, annualPriceKes } = await import(
    "../dashboard/src/lib/packageCatalog.ts"
  );
  const offer = (
    sku: string,
    name: string,
    rate: number,
    minutes: number,
    credits: number,
    annual: number,
    off: number,
  ) => ({
    sku,
    name,
    monthlyPriceKes: minutes === 300 ? 7000 : minutes === 800 ? 18000 : 35000,
    annualPriceKes: annual,
    annualDiscountPercent: off,
    seats: 3,
    minutes,
    messageCredits: credits,
    dids: 1,
    inboundKesPerMinute: rate,
    creditBurns: { sms: 1, whatsapp: 2, email: 1 },
  });
  const board = {
    discountPercent: 17,
    inboundKesPerMinute: 6,
    outboundKesPerMinute: 9,
    smsKes: 1,
    emailKes: 1,
    whatsappKes: 2,
    packages: [
      offer("scale", "Scale", 24, 1600, 5500, 378000, 10),
      offer("starter", "Starter", 26, 300, 1000, 69720, 17),
      offer("growth", "Growth", 25, 800, 2500, 194400, 10),
    ],
  };
  assert.deepEqual(plansForPage(board).map((pack) => pack.sku), ["starter", "growth", "scale"]);
  assert.equal(
    workedExample(board),
    "After your included minutes, on Starter, a 3-minute answered call costs KES 78",
  );
  assert.equal(workedExample({ ...board, packages: [] }), null);
  assert.equal(perDayKes(7000), 233);
  assert.equal(perDayMinutes(300), 10);
  assert.equal(perDayMinutes(800), 27);
  assert.equal(perDayMinutes(1600), 53);
  assert.equal(creditUseLine(board.packages[0].creditBurns), "SMS or email uses 1 credit. WhatsApp uses 2 credits.");
  const faq = pricingFaq(board.packages[0].creditBurns);
  assert.equal(faq.length, 5);
  for (const [, answer] of faq) {
    assert.ok(answer.split(/\s+/).length <= 20, answer);
    assert.doesNotMatch(answer, /vat|most popular|chat with callers/i);
  }
  assert.match(faq[1][1], /not chats with callers/);
  const offers = publishedPublicOffers(
    [
      { id: "s", sku: "starter", name: "Starter", is_active: true },
      { id: "g", sku: "growth", name: "Growth", is_active: true },
      { id: "c", sku: "scale", name: "Scale", is_active: true },
    ],
    [
      { package_id: "g", version: 1, monthly_price_kes: 12000, annual_price_kes: 119520, annual_discount_percent: 17, minutes: 800, seats: 8, dids: 1, message_credits: 500, inbound_kes_per_second: 0.1, sms_credit_burn: 1, whatsapp_credit_burn: 2, email_credit_burn: 1 },
      { package_id: "s", version: 2, monthly_price_kes: 7000, annual_price_kes: 69720, annual_discount_percent: 17, minutes: 300, seats: 3, dids: 1, message_credits: 1000, inbound_kes_per_second: 26 / 60, sms_credit_burn: 1, whatsapp_credit_burn: 2, email_credit_burn: 1 },
      { package_id: "g", version: 2, monthly_price_kes: 18000, annual_price_kes: 194400, annual_discount_percent: 10, minutes: 800, seats: 8, dids: 1, message_credits: 2500, inbound_kes_per_second: 25 / 60, sms_credit_burn: 1, whatsapp_credit_burn: 2, email_credit_burn: 1 },
      { package_id: "c", version: 2, monthly_price_kes: 35000, annual_price_kes: 378000, annual_discount_percent: 10, minutes: 1600, seats: 20, dids: 1, message_credits: 5500, inbound_kes_per_second: 0.4, sms_credit_burn: 1, whatsapp_credit_burn: 2, email_credit_burn: 1 },
    ],
  );
  const growth = offers.find((pack) => pack.sku === "growth");
  assert.equal(growth?.annualPriceKes, 194400);
  assert.equal(growth?.annualDiscountPercent, 10);
  assert.equal(growth?.messageCredits, 2500);
  assert.equal(growth?.monthlyPriceKes, 18000);
  assert.notEqual(growth?.annualPriceKes, annualPriceKes(18000, 17));
  const fallback = publishedPublicOffers(
    [{ id: "g", sku: "growth", name: "Growth", is_active: true }],
    [{ package_id: "g", version: 2, monthly_price_kes: 18000, annual_discount_percent: 10, minutes: 800, seats: 8, dids: 1, message_credits: 2500, inbound_kes_per_second: 25 / 60, sms_credit_burn: 1, whatsapp_credit_burn: 2, email_credit_burn: 1 }],
  );
  assert.equal(fallback[0]?.annualPriceKes, annualPriceKes(18000, 10));
  const rates = publishedInboundPerMinute([
    { package_id: "s", version: 1, inbound_kes_per_second: 0.1 },
    { package_id: "s", version: 2, inbound_kes_per_second: 26 / 60 },
    { package_id: "g", version: 2, inbound_kes_per_second: 25 / 60 },
    { package_id: "c", version: 2, inbound_kes_per_second: 24 / 60 },
  ]);
  assert.equal(rates.get("s"), 26);
  assert.equal(rates.get("g"), 25);
  assert.equal(rates.get("c"), 24);
});
