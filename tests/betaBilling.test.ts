/**
 * Free beta is the only surface for current businesses.
 * Run: node --experimental-strip-types --test tests/betaBilling.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFreeBeta, ownerBillingSurface } from "../dashboard/src/lib/betaBilling.ts";
import { pickBillingBanner } from "../dashboard/src/lib/billingBanner.ts";

describe("free beta surface", () => {
  it("beta, a missing status, and a missing row show only Free during beta", () => {
    for (const status of [null, undefined, "", "beta"]) {
      assert.equal(isFreeBeta(status), true);
      const surface = ownerBillingSurface(status);
      assert.equal(surface.headline, "Free during beta");
      assert.equal(surface.showInvoices, false);
      assert.equal(surface.showPayLinks, false);
      assert.equal(surface.showDunningBanner, false);
      assert.equal(surface.showEnforcement, false);
      assert.equal(surface.showPlanPicker, false);
      assert.equal(
        pickBillingBanner(
          {
            billingStatus: status || "beta",
            openInvoiceKes: 9000,
            trialEnded: false,
            voicemailUntil: "2026-10-16T00:00:00+03:00",
          },
          new Date("2026-10-20T00:00:00+03:00"),
        ),
        null,
      );
    }
  });

  it("a priced status can show invoices, pay links, banners, and the plan picker", () => {
    const surface = ownerBillingSurface("active");
    assert.equal(surface.headline, null);
    assert.equal(surface.showInvoices, true);
    assert.equal(surface.showPayLinks, true);
    assert.equal(surface.showDunningBanner, true);
    assert.equal(surface.showEnforcement, true);
    assert.equal(surface.showPlanPicker, true);
  });
});
