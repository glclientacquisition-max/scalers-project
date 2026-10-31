const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const sql = read("supabase/migrations/20261031060000_billing_overage_waivers.sql");
const fnBody = (name) => {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(at >= 0, name);
  const open = sql.indexOf("$$", at);
  return sql.slice(open, sql.indexOf("$$;", open + 2));
};

describe("Waive overage on the invoice side, with no wallet", () => {
  it("the waive never touches the wallet, credits or invoice rows", () => {
    for (const name of ["waive_period_overage", "billing_period_overage_due_kes"]) {
      const body = fnBody(name);
      for (const banned of [
        /wallet_balance_kes/, /_wallet_apply_delta/, /trial_credit/, /tenant_credits/,
        /(insert into|update|delete from)\s+public\.wallet_ledger/i,
        /update\s+public\.invoices/i, /(insert into|update|delete from)\s+public\.invoice_lines/i,
        /scalers\.(wallet_write|billing_write)/, /waive_tenant_overage/,
      ]) {
        assert.doesNotMatch(body, banned, `${name} must not match ${banned}`);
      }
    }
  });

  it("is append-only, keyed, needs a reason, and is service_role only", () => {
    assert.match(sql, /constraint billing_overage_waivers_key unique \(idempotency_key\)/);
    assert.match(sql, /before update or delete on public\.billing_overage_waivers/);
    assert.match(sql, /raise exception 'billing_overage_waivers is append-only'/);
    const body = fnBody("waive_period_overage");
    assert.match(body, /length\(v_reason\) < 3/);
    assert.match(body, /idempotency key required/);
    assert.match(body, /replay := true/);
    assert.equal((body.match(/insert into public\.ops_audit_log/g) || []).length, 1);
    assert.match(body, /'overage_waived'/);
    assert.match(sql, /revoke all on function public\.waive_period_overage\(uuid, text, text, text\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.waive_period_overage\(uuid, text, text, text\) to service_role;/);
    assert.match(sql, /revoke all on table public\.billing_overage_waivers from public, anon, authenticated;/);
  });

  it("the invoice build subtracts waivers from on-demand usage", () => {
    const due = fnBody("billing_period_overage_due_kes");
    assert.match(due, /billing_period_on_demand_kes\(p_tenant_id\) - coalesce\(v_waived, 0\)/);
  });

  it("Admin: confirm, reason, key, risky step-up, history shows the amount", () => {
    const route = read("dashboard/src/app/api/admin/billing/route.ts");
    const at = route.indexOf('action === "waive_period_overage"');
    assert.ok(at > 0);
    const blk = route.slice(at, at + 900);
    assert.match(blk, /body\.confirm !== true/);
    assert.match(blk, /note\.length < 3/);
    assert.match(blk, /waivePeriodOverage\(\{ businessId, reason: note, actor, idempotencyKey \}\)/);
    assert.ok(route.indexOf("stepUpGateSession(") < at);
    assert.match(read("dashboard/src/lib/ops/stepUpCore.ts"), /risky: \[[^\]]*"waive_period_overage"/);
    const lib = read("dashboard/src/lib/adminBilling.ts");
    assert.match(lib, /rpc\("waive_period_overage"/);
    assert.doesNotMatch(lib, /waive_tenant_overage|waiveTenantOverage/);
    const panel = read("dashboard/src/components/AdminShopMoneyPanel.tsx");
    const p = panel.indexOf('open={task === "waive"}');
    const sheet = panel.slice(panel.lastIndexOf("<ConfirmSheet", p), p + 2600);
    assert.match(sheet, /confirmDisabled=\{waiveNote\.trim\(\)\.length < 3\}/);
    assert.match(sheet, /action: "waive_period_overage"/);
    assert.match(sheet, /confirm: true/);
    assert.match(read("dashboard/src/lib/adminBillingCopy.ts"), /row\.action === "overage_waived"[\s\S]{0,200}waived`/);
  });
});
