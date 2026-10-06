import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hoursCapturePasses,
  inferPriceMode,
  homeCatalogPasses,
  parseCaptureHours,
  shopCatalogPasses,
} from "../dashboard/src/lib/outcomeGates.ts";
import {
  holdCaptureTenant,
  reviewGapCopy,
  scoreCaptureTenant,
} from "../dashboard/src/lib/completenessStub.ts";

describe("outcome gates", () => {
  it("accepts Mon-Sat 8-7 and the same hours with en dashes", () => {
    assert.equal(hoursCapturePasses("Mon-Sat 8-7"), true);
    assert.equal(hoursCapturePasses("Mon–Sat 8–7"), true);
    const schedule = parseCaptureHours("Mon-Sat 8-7");
    assert.equal(schedule?.days.mon?.open, "08:00");
    assert.equal(schedule?.days.mon?.close, "19:00");
    assert.equal(schedule?.days.sat?.open, "08:00");
    assert.equal(schedule?.days.sun, null);
    assert.equal(hoursCapturePasses("8-7"), false);
  });

  it("rejects we sell stuff and passes a real shop catalog", () => {
    assert.equal(inferPriceMode("we sell stuff"), null);
    assert.equal(shopCatalogPasses([{ name: "we sell stuff", price: "we sell stuff" }]), false);
    assert.equal(
      shopCatalogPasses(
        Array.from({ length: 9 }, (_, index) => ({
          name: `Item ${index + 1}`,
          price: "500",
          category: "phones",
        }))
      ),
      false
    );
    assert.equal(
      shopCatalogPasses(
        Array.from({ length: 10 }, (_, index) => ({
          name: `Item ${index + 1}`,
          price: "500",
        }))
      ),
      true
    );
    assert.equal(
      shopCatalogPasses([
        { name: "Charger", category: "Power", price: "500" },
        { name: "Case", category: "Protection", price: "from 300" },
        { name: "Cable", category: "Power leads", price: "200-400" },
      ]),
      true
    );
  });

  it("requires price mode and a site visit for home services", () => {
    assert.equal(
      homeCatalogPasses([
        { name: "Home cleaning" },
        { name: "Installation" },
        { name: "Inspection / assessment" },
      ]),
      false
    );
    assert.equal(
      homeCatalogPasses([
        { name: "Home cleaning", pricing_mode: "ask", site_visit_required: true },
        { name: "Installation", pricing_mode: "from", site_visit_required: true },
        { name: "Inspection", pricing_mode: "fixed", site_visit_required: false },
      ]),
      true
    );
  });
});

describe("completeness stub", () => {
  it("scores seed and import at 0, and owner at 100", () => {
    const named = (source?: "seed" | "import" | "owner") =>
      Array.from({ length: 10 }, (_, index) => ({
        name: source === "seed" ? "Chargers" : `Sku ${index + 1}`,
        source,
      }));
    assert.equal(
      scoreCaptureTenant({ vertical: "retail", product_catalog: named("seed") }).domains.catalog,
      0
    );
    assert.equal(
      scoreCaptureTenant({ vertical: "retail", product_catalog: named("import") }).domains.catalog,
      0
    );
    assert.equal(
      scoreCaptureTenant({ vertical: "retail", product_catalog: named("owner") }).domains.catalog,
      100
    );
    const backfill = scoreCaptureTenant(
      {
        vertical: "retail",
        business_name: "Chapter One",
        product_catalog: named("owner"),
      },
      { "identity.business_name": "seed", "catalog.product.1.name": "seed" }
    );
    assert.equal(backfill.domains.identity, 0);
    assert.equal(backfill.ready_badge, false);
    assert.equal(
      reviewGapCopy("Add products or services with owner-confirmed names and prices."),
      "Review and confirm your catalogue."
    );
  });

  it("keeps a seeds-only tenant under 20 with no ready badge and holds locked", () => {
    const score = scoreCaptureTenant({
      business_name: "Chapter One",
      vertical: "retail",
      product_catalog: Array.from({ length: 10 }, () => ({ name: "Chargers" })),
      faqs: [{ question: "Do you deliver?", answer: "Yes. Same-day when we can." }],
      business_policies: {
        payment: "M-Pesa and cash. Confirm other methods with the team if asked.",
        delivery:
          "Same-day Nairobi delivery for stocked items when available; countrywide shipping on request.",
        returns: "Returns and exchanges follow shop policy. Confirm details with the team if unsure.",
      },
    });
    assert.ok(score.overall <= 20, `overall ${score.overall}`);
    assert.equal(score.ready_badge, false);
    const hold = holdCaptureTenant({
      vertical: "retail",
      product_catalog: [{ name: "Chargers", holdable: true }],
    });
    assert.equal(hold.allowed, false);
    assert.ok(hold.reasons.length >= 2);
    const catalogueHold = holdCaptureTenant({
      vertical: "retail",
      whatsapp_notification_number: "+254700000000",
      product_catalog: [{ name: "Charger", source: "owner" }],
      business_policies: { holds: { allowed: true } },
    });
    assert.equal(catalogueHold.allowed, true);
  });
});
