"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  invoiceOverdue,
  periodEndWithinRolloverWindow,
  ROLLOVER_SOON_MS,
} = require("../dashboard/src/lib/adminBillingPeriod.ts");

describe("admin billing invoices helpers", () => {
  it("marks overdue open invoices past due_at", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    assert.equal(invoiceOverdue("2026-10-14T00:00:00Z", "open", now), true);
    assert.equal(invoiceOverdue("2026-10-20T00:00:00Z", "open", now), false);
    assert.equal(invoiceOverdue("2026-10-14T00:00:00Z", "paid", now), false);
  });

  it("detects period end within rollover window", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const soon = new Date(now + ROLLOVER_SOON_MS - 60_000).toISOString();
    const later = new Date(now + ROLLOVER_SOON_MS + 60_000).toISOString();
    assert.equal(periodEndWithinRolloverWindow(soon, now), true);
    assert.equal(periodEndWithinRolloverWindow(later, now), false);
  });
});
