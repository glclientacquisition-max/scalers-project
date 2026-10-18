/**
 * Desk billing banner priority. One banner. Beta and a clear active plan stay quiet.
 * Run: node --experimental-strip-types --test tests/billingBanner.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickBillingBanner, type BannerSub } from "../dashboard/src/lib/billingBanner.ts";

const R = Date.parse("2026-10-01T00:00:00+03:00");
const DAY = 86_400_000;

function at(days: number): Date {
  return new Date(R + days * DAY);
}

function sub(daysStatus: BannerSub["billingStatus"], over: Partial<BannerSub> = {}): BannerSub {
  return {
    billingStatus: daysStatus,
    voicemailUntil: "2026-10-16T00:00:00+03:00",
    pauseOn: "2026-10-09T00:00:00+03:00",
    trialEnded: false,
    openInvoiceKes: 8120,
    payToken: "tok_1",
    ...over,
  };
}

describe("pickBillingBanner", () => {
  it("follows the date line and returns one banner", () => {
    const cases: Array<[number, BannerSub["billingStatus"], string]> = [
      [0, "past_due", "grace"],
      [3, "grace", "grace"],
      [7, "grace", "grace"],
      [8, "suspended", "voicemail"],
      [14, "suspended", "voicemail"],
      [15, "suspended", "line_closed"],
      [30, "cancelled", "cancelled"],
    ];
    for (const [day, status, kind] of cases) {
      const banner = pickBillingBanner(sub(status), at(day));
      assert.equal(Array.isArray(banner), false);
      assert.equal(banner?.kind, kind, `day ${day}`);
    }
    const grace = pickBillingBanner(sub("grace"), at(3));
    assert.match(grace?.text || "", /Payment due\. Your Business Assistant pauses on 9 Oct\./);
    const voice = pickBillingBanner(sub("suspended"), at(8));
    assert.match(voice?.text || "", /voicemail until 16 Oct/);
    assert.match(voice?.text || "", /Inbox only/);
  });

  it("trial ended beats grace", () => {
    const banner = pickBillingBanner(sub("grace", { trialEnded: true }), at(3));
    assert.equal(banner?.kind, "trial_ended");
    assert.equal(banner?.text, "Trial ended.");
  });

  it("beta and a clear active plan have no banner", () => {
    assert.equal(pickBillingBanner(sub("beta"), at(0)), null);
    assert.equal(
      pickBillingBanner(sub("active", { openInvoiceKes: null, payToken: null }), at(0)),
      null,
    );
  });

  it("an open invoice before it is past due is the invoice banner", () => {
    const banner = pickBillingBanner(
      { billingStatus: "active", openInvoiceKes: 1000, payToken: null, trialEnded: false },
      at(0),
    );
    assert.equal(banner?.kind, "invoice_due");
  });

  it("hides Pay KSh when there is no token", () => {
    const hidden = pickBillingBanner(sub("past_due", { payToken: null }), at(0));
    assert.equal(hidden?.kind, "grace");
    assert.doesNotMatch(hidden?.action?.label || "", /Pay KSh/);
    assert.equal(hidden?.action?.href, "/settings/billing");
    const shown = pickBillingBanner(sub("past_due"), at(0));
    assert.equal(shown?.action?.label, "Pay KSh 8,120");
    assert.equal(shown?.action?.href, "/pay/tok_1");
  });
});
