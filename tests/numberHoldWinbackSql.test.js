const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const up = fs.readFileSync(path.join(root, "docs/supabase/number_hold_winback.sql"), "utf8");
const down = fs.readFileSync(path.join(root, "docs/supabase/number_hold_winback_down.sql"), "utf8");
const code = up.replace(/--[^\n]*/g, "");

test("draft only: marked not applied and not a CLI migration", () => {
  assert.match(up, /DRAFT: NOT APPLIED/);
  assert.match(down, /DRAFT: NOT APPLIED/);
  const migs = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.ok(!migs.some((f) => /hold|winback/i.test(f)));
});

test("defaults: switch on, fee none, 14 days, 1-90", () => {
  assert.match(code, /hold_winback_enabled boolean not null default true/);
  assert.match(code, /reactivation_fee_kes numeric\(12, 2\),/);
  assert.doesNotMatch(code, /reactivation_fee_kes numeric\(12, 2\) (not null|default)/);
  assert.match(code, /number_hold_days integer not null default 14/);
  assert.match(code, /number_hold_days between 1 and 90/);
});

test("restore goes only to the previous business on a paid package", () => {
  const fn = code.slice(code.indexOf("function public.admin_restore_held_number"), code.indexOf("function public.number_on_winback_hold"));
  assert.match(fn, /last_tenant_id is distinct from p_tenant_id/);
  assert.match(fn, /billing_status|v_status is distinct from 'active'/);
  assert.match(code, /new\.tenant_id is distinct from old\.last_tenant_id/);
});

test("every writer needs actor, reason, confirm and writes audit; service role only", () => {
  for (const fn of ["admin_set_number_hold_settings", "admin_hold_number_for_winback", "admin_end_number_hold", "admin_restore_held_number"]) {
    const body = code.slice(code.indexOf(`function public.${fn}(`));
    const one = body.slice(0, body.indexOf("$$;", body.indexOf("$$") + 2));
    assert.match(one, /_package_editor_actor\(p_actor, p_reason\)/, fn);
    assert.match(one, /p_confirm is distinct from true/, fn);
    assert.match(one, /_billing_audit\(/, fn);
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
  }
  assert.doesNotMatch(code, /to (anon|authenticated)\b/);
  assert.match(code, /hold and win-back is off/);
});

test("no price literal and the down file drops everything", () => {
  assert.doesNotMatch(code, /reactivation_fee_kes\s*(=|default)\s*\d/);
  for (const name of ["number_on_winback_hold", "admin_restore_held_number", "admin_end_number_hold", "admin_hold_number_for_winback", "admin_set_number_hold_settings", "sautikit_did_pool_winback_guard", "winback_hold", "number_hold_days", "reactivation_fee_kes", "hold_winback_enabled"]) {
    assert.match(down, new RegExp(name));
  }
});
