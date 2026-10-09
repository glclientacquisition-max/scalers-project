"use strict";

// Shape guards for package_state_rules.sql, the rollover and tenant_billing_state.sql.
// Behaviour is exercised on a throwaway Postgres by tests/sql/package_state/run.sh.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "docs/supabase", f), "utf8").replace(/^\s*--.*$/gm, "");

describe("package state rules SQL", () => {
  const rules = read("package_state_rules.sql");
  const roll = read("package_period_rollover.sql");
  const view = read("tenant_billing_state.sql");

  it("grant expiry lives in exactly one function and every consumer calls it", () => {
    assert.match(rules, /create or replace function public\.billing_grant_minutes_for_period/);
    for (const [name, src] of [["rules", rules], ["rollover", roll], ["view", view]]) {
      assert.match(src, /billing_grant_minutes_for_period\(/, `${name} must use the single grant rule`);
      assert.doesNotMatch(src.replace(/create or replace function public\.billing_grant_minutes_for_period[\s\S]*?\$\$;/, ""),
        /from public\.tenant_minute_grants g\s+where/, `${name} must not re-implement the grant rule`);
    }
  });

  it("no package is explicit and unassign is service-role only", () => {
    assert.match(rules, /create or replace function public\.unassign_tenant_package/);
    assert.match(rules, /status = 'cancelled'/);
    assert.match(rules, /v_when not in \('now', 'period_end'\)/);
    assert.match(rules, /grant execute on function public\.unassign_tenant_package\(uuid, text, text, text\) to service_role/);
  });

  it("downgrades are scheduled, upgrades prorate and keep grants", () => {
    assert.match(rules, /pending_change = case when v_sub\.package_id = p_package_id then 'period_change' else 'downgrade' end/);
    assert.match(rules, /v_base \+ ceil\(greatest\(v_pack\.minutes - v_cur\.minutes, 0\) \* v_frac\)/);
    assert.match(rules, /drop function if exists public\.assign_tenant_package\(uuid, uuid, text\);/);
  });

  it("rollover applies pending changes, rolls no-package rows and never deletes grants", () => {
    assert.match(roll, /s\.status in \('active', 'cancelled'\)/);
    assert.match(roll, /r\.pending_change = 'unassign'/);
    assert.doesNotMatch(roll, /delete from public\.tenant_minute_grants/);
  });

  it("tenant_billing_state is security_invoker and reads the SMS ledger when present", () => {
    assert.match(view, /with \(security_invoker = true\)/);
    assert.match(view, /to_regclass\('public\.notify_sms_billable'\)/);
    assert.match(view, /grant select \(tenant_id, minutes, period_start, period_end\) on public\.tenant_minute_grants to authenticated/);
    for (const col of ["period_start", "period_end", "package_state", "included_minutes", "granted_minutes",
      "remaining_minutes", "sms_used", "on_demand_enabled", "enforcement_mode", "mode_label", "spend_cap_kes", "overage_owed_kes"]) {
      assert.match(view, new RegExp(`as ${col}\\b|b\\.${col},`), `missing column ${col}`);
    }
  });
});
