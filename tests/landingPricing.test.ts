// Landing P0-1 (30 Oct): pricing from billing_packages, Beta program featured, plan carried into Request access.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { accessPlanFromParam, withPlanPrefix, BETA_PROGRAM } from "../dashboard/src/lib/accessPlan.ts";
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

test("Beta is featured and picked first; no free, no trial, no hard-coded price", () => {
  const ui = read("components/marketing/PackagePrices.tsx");
  assert.match(ui, /useState<string>\(BETA_PLAN\)/);
  assert.match(ui, /featured>/);
  assert.match(ui, /href=\{`\/signup\?plan=\$\{encodeURIComponent\(picked\)\}`\}/);
  const copy = JSON.stringify(BETA_PROGRAM) + ui + read("app/pricing/page.tsx");
  assert.doesNotMatch(copy, /\bfree\b|\btrial\b|coming soon/i);
  assert.doesNotMatch(ui, /KES \d|KSh \d|\d{1,3},\d{3}/);
  assert.match(read("app/signup/page.tsx"), /<RequestAccessForm plan=\{plan\} \/>/);
  assert.match(read("app/signup/page.tsx"), /<PlanRequestForm searchParams=\{searchParams\} \/>/);
});

test("pricing v2: at most 3 live packages, rates and the worked example from the live board, true FAQ only", async () => {
  const ui = read("components/marketing/PackagePrices.tsx") + read("components/marketing/pricingMath.ts");
  assert.match(ui, /MAX_PUBLIC_PACKAGES = 3/);
  assert.match(ui, /\.slice\(0, MAX_PUBLIC_PACKAGES\)/);
  assert.match(ui, /className="landing-orbs" aria-hidden data-pricing-orbs=""/);
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
  // No prepaid wallet, M-Pesa, annual toggle or VAT claim on the public page.
  assert.doesNotMatch(ui + page, /wallet|top.?up|m-?pesa|annual|yearly|vat/i);
  const catalog = read("lib/packageCatalog.ts");
  assert.match(catalog, /billing_package_versions/);
  assert.match(catalog, /publishedInboundPerMinute/);
  assert.match(ui, /pack\.inboundKesPerMinute/);
  assert.doesNotMatch(ui, /Answered calls/);
  const { workedExample, usageRows } = await import("../dashboard/src/components/marketing/pricingMath.ts");
  const { publishedInboundPerMinute } = await import("../dashboard/src/lib/packageCatalog.ts");
  const offer = (sku: string, name: string, rate: number) => ({
    sku, name, monthlyPriceKes: 7000, annualPriceKes: 0, seats: 1, minutes: 300, sms: 200, email: 0, staffWa: 0, dids: 1, inboundKesPerMinute: rate,
  });
  const board = {
    discountPercent: 0, inboundKesPerMinute: 6, outboundKesPerMinute: 9, smsKes: 1, emailKes: 0, whatsappKes: 2,
    packages: [offer("starter", "Starter", 26), offer("growth", "Growth", 25), offer("scale", "Scale", 24)],
  };
  assert.equal(workedExample(board), "On Starter, a 3-minute answered call costs KES 78");
  assert.equal(workedExample({ ...board, packages: [] }), null);
  assert.deepEqual(usageRows(board).map((r) => r[0]), ["SMS", "WhatsApp"]);
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
