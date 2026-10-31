const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/20261031050000_roll_package_periods_fault_tolerant.sql"),
  "utf8",
);

describe("roll_package_periods: one tenant's failure does not stop the run", () => {
  it("keeps the signature and return shape", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.roll_package_periods\(p_dry_run boolean DEFAULT false\)/);
    const ret = sql.match(/RETURNS TABLE\(([^)]*)\)/)[1].split(",");
    assert.equal(ret.length, 17);
    assert.match(sql, /SECURITY DEFINER\s+SET search_path TO 'public'/);
  });

  it("wraps each tenant in its own exception block and only returns rolled tenants", () => {
    const loop = sql.slice(sql.indexOf("  loop\n"), sql.indexOf("\n  end loop;\nend;"));
    assert.ok(loop.indexOf("    begin\n") < loop.indexOf("v_period := r.period;"));
    assert.match(loop, /exception when others then\n\s+v_ok := false;/);
    assert.match(loop, /if v_ok then\n\s+return next;/);
    assert.equal((loop.match(/return next;/g) || []).length, 1);
  });

  it("logs and alerts the failure, outside dry run, without aborting", () => {
    const handler = sql.slice(sql.indexOf("exception when others then\n      v_ok := false;"));
    assert.match(handler, /'package_period_rollover_failed'/);
    assert.match(handler, /get stacked diagnostics v_err_state = returned_sqlstate, v_err_msg = message_text/);
    assert.match(handler, /'package_rollover_failed:' \|\| r\.tenant_id::text/);
    assert.match(handler, /exception when unique_violation then/);
    assert.match(handler, /if not p_dry_run then/);
    assert.doesNotMatch(handler.slice(0, handler.indexOf("if v_ok then")), /\braise exception\b/);
  });

  it("clears the tenant's open alert once it rolls", () => {
    assert.match(sql, /set status = 'resolved'[\s\S]*kind = 'package_rollover_failed:' \|\| r\.tenant_id::text/);
  });
});
