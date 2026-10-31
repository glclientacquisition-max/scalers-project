const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

describe("Admin Billing: waive overage", () => {
  const lib = read("dashboard/src/lib/adminBilling.ts");
  const route = read("dashboard/src/app/api/admin/billing/route.ts");
  const panel = read("dashboard/src/components/AdminShopMoneyPanel.tsx");

  it("calls the existing waive_tenant_overage RPC with note, actor and key", () => {
    const fn = lib.slice(lib.indexOf("export async function waiveTenantOverage"));
    assert.match(fn, /rpc\("waive_tenant_overage"/);
    for (const arg of ["p_tenant_id", "p_note", "p_actor", "p_idempotency_key"]) {
      assert.ok(fn.slice(0, 800).includes(arg), arg);
    }
  });

  it("route requires confirm, a reason and a key, and uses the signed-in actor", () => {
    const at = route.indexOf('action === "waive_overage"');
    assert.ok(at > 0);
    const blk = route.slice(at, at + 900);
    assert.match(blk, /body\.confirm !== true/);
    assert.match(blk, /note\.length < 3/);
    assert.match(blk, /idempotency_key/);
    assert.match(blk, /waiveTenantOverage\(\{ businessId, note, actor, idempotencyKey \}\)/);
    // Step-up and Super Admin gate run before any action branch.
    assert.ok(route.indexOf("stepUpGateSession(") < at);
    assert.ok(route.indexOf("isLegacyAuthenticated()", route.indexOf("export async function POST")) < at);
  });

  it("panel asks for confirmation with a reason before posting", () => {
    const at = panel.indexOf('open={task === "waive"}');
    assert.ok(at > 0);
    const blk = panel.slice(panel.lastIndexOf("<ConfirmSheet", at), at + 2400);
    assert.match(blk, /confirmDisabled=\{waiveNote\.trim\(\)\.length < 3\}/);
    assert.match(blk, /action: "waive_overage"/);
    assert.match(blk, /confirm: true/);
    assert.match(blk, /idempotency_key: waiveKey/);
    assert.match(panel, /setWaiveKey\(crypto\.randomUUID\(\)\)/);
  });
});
