"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const hub = require("../dashboard/src/lib/adminBillingHub.ts");

const row = (overrides) => ({
  id: "1",
  business_name: "A",
  sautikit_virtual_number: "+254700000001",
  packageName: "Starter",
  packageSku: "starter",
  period: "month",
  minutesIncluded: 300,
  minutesUsed: 290,
  minutesRemaining: 10,
  billing_enforcement: "off",
  on_demand_usage_enabled: false,
  status: "low_minutes",
  statusLabel: "Low minutes",
  ...overrides,
});

describe("admin billing hub", () => {
  it("sorts exhausted and low minutes ahead of ok", () => {
    const sorted = hub.sortBillingQueue([
      row({ id: "ok", status: "ok", statusLabel: "OK", minutesRemaining: 200 }),
      row({ id: "ex", status: "exhausted", statusLabel: "Exhausted", minutesRemaining: 0 }),
      row({ id: "low", status: "low_minutes", statusLabel: "Low minutes", minutesRemaining: 10 }),
    ]);
    assert.deepEqual(sorted.map((r) => r.id), ["ex", "low", "ok"]);
  });

  it("filters attention kinds", () => {
    const needs = hub.attentionRows([
      row({ id: "a", packageName: null, status: "ok", statusLabel: "OK" }),
      row({ id: "b", status: "exhausted", statusLabel: "Exhausted", minutesRemaining: 0 }),
    ]);
    assert.equal(needs.length, 2);
    assert.equal(hub.filterAttentionKind(needs, "no_package").length, 1);
  });
});
