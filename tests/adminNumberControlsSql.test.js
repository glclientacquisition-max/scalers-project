const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const mig = 'supabase/migrations/20261027081642_admin_number_controls_v1.sql';
const migDown = 'docs/supabase/admin_number_controls_v1_down.sql';
const code = fs.readFileSync(path.join(root, mig), 'utf8');
const down = fs.readFileSync(path.join(root, migDown), 'utf8');

const FNS = {
  admin_restore_business_number: 'uuid, text, text, boolean, text',
  admin_lift_quarantine: 'text, text, text, boolean',
  admin_move_number: 'text, uuid, uuid, text, text, boolean',
};
const HELPERS = {
  _admin_did_last9: 'text',
  _admin_did_is_protected: 'text',
  _admin_did_refuse_protected: 'text',
  _admin_did_tenant_state: 'uuid',
  _admin_did_pool_state: 'uuid',
  _admin_did_assert_no_other_holder: 'text, uuid\\[\\]',
};

function body(name) {
  const start = code.indexOf(`function public.${name}(`);
  assert.ok(start > 0, name);
  const open = code.indexOf('$$', start);
  return code.slice(start, code.indexOf('$$;', open + 2));
}

test('docs copy matches the migration (one source of SQL)', () => {
  assert.equal(fs.readFileSync(path.join(root, 'docs/supabase/admin_number_controls_v1.sql'), 'utf8'), code);
});

test('migration version is unique in supabase/migrations', () => {
  const versions = fs.readdirSync(path.join(root, 'supabase/migrations'))
    .map((f) => f.split('_')[0]);
  assert.equal(versions.filter((v) => v === '20261027081642').length, 1);
});

test('rpc grants: no anon, authenticated or PUBLIC execute; service_role only', () => {
  for (const [fn, args] of Object.entries({ ...FNS, ...HELPERS })) {
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\(${args}\\) from public, anon, authenticated;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\(${args}\\) to service_role;`), fn);
  }
  assert.doesNotMatch(code, /grant [^;]*to [^;]*\b(anon|authenticated|public)\b/i);
});

test('writers are security definer with a pinned search_path', () => {
  for (const fn of Object.keys(FNS)) {
    const one = body(fn);
    assert.match(one, /security definer/, fn);
    assert.match(one, /set search_path = public, pg_temp/, fn);
  }
});

test('every writer needs actor + reason, writes audit, and locks rows', () => {
  for (const fn of Object.keys(FNS)) {
    const one = body(fn);
    assert.match(one, /_package_editor_actor\(p_actor, p_reason\)/, fn);
    assert.match(one, /_billing_audit\(/, fn);
    assert.match(one, /for update/, fn);
    assert.match(one, /'before'/, fn);
    assert.match(one, /'after'/, fn);
    assert.match(one, /'noop', true/, fn);
  }
  assert.match(body('admin_restore_business_number'), /p_confirm is distinct from true/);
  assert.match(body('admin_move_number'), /p_confirm is distinct from true/);
});

// v1 as applied (historical). v1.2 (20261027130500) removes this refusal; see adminNumberControlsV12Sql.test.js.
test('v1 (superseded by v1.2): protected number +254709221536 refused in any form, by last 9 digits', () => {
  assert.match(body('_admin_did_is_protected'), /= '709221536'/);
  assert.match(body('_admin_did_last9'), /right\(regexp_replace\(p_number, '\\D', '', 'g'\), 9\)/);
  for (const fn of Object.keys(FNS)) {
    assert.match(body(fn), /_admin_did_refuse_protected\(/, fn);
  }
});

test('Ops rules: restore only from quarantine for the same business, non-payment needs active', () => {
  const r = body('admin_restore_business_number');
  assert.match(r, /status = 'disabled'/);
  assert.match(r, /last_tenant_id is distinct from p_tenant_id/);
  assert.match(r, /archived_at is not null/);
  assert.match(r, /billing_status is distinct from 'active'/);
  assert.match(r, /line_status = 'active'/);
  assert.match(r, /quarantine_until = null, quarantined_at = null, winback_hold = false/);
  assert.match(r, /_admin_did_assert_no_other_holder\(/);
});

test('Ops rules: lift keeps last_tenant_id and asks for confirm when the old business has no line', () => {
  const l = body('admin_lift_quarantine');
  assert.match(l, /status = 'available', tenant_id = null/);
  assert.doesNotMatch(l, /last_tenant_id = null/);
  assert.match(l, /p_confirm is distinct from true/);
  assert.match(l, /admin_restore_business_number/);
});

test('Ops/Voice rules: move frees the source first, no swaps, no quarantine, digit check', () => {
  const m = body('admin_move_number');
  const fromAt = m.indexOf("'pending:' || p_from_tenant::text");
  const toAt = m.indexOf('set sautikit_virtual_number = v_row.e164');
  assert.ok(fromAt > 0 && toAt > fromAt);
  assert.match(m, /no swaps/);
  assert.match(m, /_admin_did_assert_no_other_holder\(v_row\.e164, array\[p_from_tenant, p_to_tenant\]\)/);
  assert.match(m, /set tenant_id = p_to_tenant, assigned_at = now\(\)/);
  assert.doesNotMatch(m, /status = 'quarantine'\s*,|quarantine_until = now|make_interval/);
});

test('DB-only: no billing, wallet, enforcement or SautiKit side effects', () => {
  assert.doesNotMatch(code, /billing_enforcement\s*=|billing_status\s*=\s*'|wallet_balance_kes\s*=|net\.http|http_post|release_did_from_business\(|transition_subscription_billing_status\(/);
  assert.doesNotMatch(code, /drop\s+table|truncate|delete\s+from/i);
});

test('down file drops every function it adds', () => {
  for (const [fn, args] of Object.entries({ ...FNS, ...HELPERS })) {
    assert.match(down, new RegExp(`drop function if exists public\\.${fn}\\(${args}\\);`), fn);
  }
});
