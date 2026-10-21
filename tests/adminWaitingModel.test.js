/**
 * Super Admin: one waiting-for-number rule across Today, Businesses, Numbers.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isWaitingForNumber,
  pendingFromBusinesses,
} = require("../dashboard/src/lib/adminWaitingModel.ts");

describe("adminWaitingModel", () => {
  it("waits only on pending: numbers for active shops", () => {
    assert.equal(
      isWaitingForNumber({
        sautikit_virtual_number: "pending:abc",
        status: "waiting",
        is_active: true,
        archived_at: null,
      }),
      true,
    );
  });

  it("never waits when archived", () => {
    assert.equal(
      isWaitingForNumber({
        sautikit_virtual_number: "pending:abc",
        status: "archived",
        is_active: false,
        archived_at: "2026-01-01T00:00:00Z",
      }),
      false,
    );
  });

  it("pendingFromBusinesses maps waiting rows", () => {
    const rows = pendingFromBusinesses([
      {
        id: "a",
        business_name: "Shop A",
        sautikit_virtual_number: "pending:a",
        created_at: "2026-01-01",
        status: "waiting",
        is_active: true,
        archived_at: null,
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].business_name, "Shop A");
  });
});
