const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { billableTalkSeconds, quoteCallOverage, inboundOpen } = require("../src/billing/packageOverage");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("package overage", () => {
  it("meters included talk without a debit", () => {
    const quote = quoteCallOverage({
      usedSeconds: 0,
      includedMinutes: 300,
      deltaSeconds: 120,
      enforcement: "soft",
      onDemand: false,
      kesPerSecond: 0.05,
    });
    assert.deepEqual(quote, {
      meterSeconds: 120,
      overageSeconds: 0,
      debitKes: 0,
      reason: "included",
    });
  });

  it("past the cap with on-demand off meters and does not debit", () => {
    const quote = quoteCallOverage({
      usedSeconds: 300 * 60,
      includedMinutes: 300,
      deltaSeconds: 40,
      enforcement: "soft",
      onDemand: false,
      kesPerSecond: 0.05,
    });
    assert.equal(quote.meterSeconds, 40);
    assert.equal(quote.overageSeconds, 40);
    assert.equal(quote.debitKes, 0);
    assert.equal(quote.reason, "cap");
  });

  it("past the cap with on-demand on debits only the overage seconds", () => {
    const inbound = quoteCallOverage({
      usedSeconds: 17990,
      includedMinutes: 300,
      deltaSeconds: 30,
      enforcement: "hard",
      onDemand: true,
      kesPerSecond: 0.05,
    });
    assert.equal(inbound.overageSeconds, 20);
    assert.equal(inbound.debitKes, 1);
    assert.equal(inbound.reason, "on_demand");

    const outbound = quoteCallOverage({
      usedSeconds: 0,
      includedMinutes: 0,
      deltaSeconds: 10,
      enforcement: "soft",
      onDemand: true,
      kesPerSecond: 0.1,
    });
    assert.equal(outbound.debitKes, 1);
  });

  it("beta meters past the cap and does not debit even when on-demand is on", () => {
    const quote = quoteCallOverage({
      usedSeconds: 300 * 60,
      includedMinutes: 300,
      deltaSeconds: 40,
      enforcement: "off",
      onDemand: true,
      kesPerSecond: 0.05,
    });
    assert.equal(quote.meterSeconds, 40);
    assert.equal(quote.debitKes, 0);
    assert.equal(quote.reason, "beta");
  });

  it("rejects the next call when the package is used up and on-demand is off", () => {
    assert.deepEqual(
      inboundOpen({ minutesIncluded: 300, secondsUsed: 300 * 60, onDemand: false }),
      { open: false, reason: "package_exhausted" }
    );
    assert.deepEqual(
      inboundOpen({ minutesIncluded: 300, secondsUsed: 300 * 60 - 1, onDemand: false }),
      { open: true, reason: "included" }
    );
    assert.deepEqual(
      inboundOpen({ minutesIncluded: 300, secondsUsed: 300 * 60, onDemand: true }),
      { open: true, reason: "on_demand" }
    );
    assert.deepEqual(
      inboundOpen({ minutesIncluded: 0, secondsUsed: 100, onDemand: false }),
      { open: true, reason: "no_package_minutes" }
    );
  });

  it("does not bill unanswered outbound ring time", () => {
    assert.equal(
      billableTalkSeconds({ outboundUnanswered: true, durationSeconds: 30, minutes: 0.5 }),
      0
    );
    assert.equal(billableTalkSeconds({ durationSeconds: 45, minutes: 0.8 }), 45);
  });

  it("hangup uses consume_call_seconds and skips the legacy debit when it applies", () => {
    const db = read("src/db.js");
    const sql = read("docs/supabase/package_minute_consume.sql");
    assert.match(db, /consume_call_seconds/);
    assert.match(db, /if \(metered\.applied\)/);
    assert.match(db, /metered\.reason !== 'rpc_missing'/);
    assert.match(sql, /branch: beta meter no debit/);
    assert.match(sql, /branch: cap meter no debit/);
    assert.match(sql, /branch: on_demand debit overage seconds/);
    assert.match(sql, /seconds_used = v_used \+ v_delta/);
    assert.match(sql, /round\(v_overage \* v_rate, 2\)/);
    assert.match(sql, /branch: sms cap no debit/);
    assert.match(sql, /branch: sms on_demand debit/);
    assert.match(sql, /'sms_charge'/);
    assert.match(sql, /sms_allowance_exhausted/);
    assert.match(sql, /Does not replace tenants_protect_wallet_columns/);
    assert.doesNotMatch(sql, /create or replace function public\.tenants_protect_wallet_columns/);
  });
});
