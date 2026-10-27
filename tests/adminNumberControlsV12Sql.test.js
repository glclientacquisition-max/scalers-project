/**
 * Admin number controls v1.2 (27 Oct 2026, Alvin: "yes we want it release able"):
 * +254709221536 is no longer refused. The three RPCs keep every other rule; the
 * protected-line helpers are dropped; service_role only; the down file restores the refusal.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const MIG = 'supabase/migrations/20261027125836_admin_number_controls_v1_2.sql';
const up = read(MIG);
const docsCopy = read('docs/supabase/admin_number_controls_v1_2.sql');
const down = read('docs/supabase/admin_number_controls_v1_2_down.sql');
const v1 = read('supabase/migrations/20261027081642_admin_number_controls_v1.sql');
const v11 = read('supabase/migrations/20261027082533_admin_number_controls_v1_1.sql');
const strip = (s) => s.replace(/--[^\n]*/g, '').split('\n').filter((l) => l.trim()).join('\n');

const FNS = {
  admin_restore_business_number: 'uuid, text, text, boolean, text',
  admin_lift_quarantine: 'text, text, text, boolean',
  admin_move_number: 'text, uuid, uuid, text, text, boolean',
};

function body(src, name) {
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return src.slice(start, src.indexOf('\n$$;\n', start) + 5);
}

test('docs copy is the same SQL', () => {
  assert.equal(strip(docsCopy), strip(up));
});

test('no protected-line refusal left in the code (comments aside)', () => {
  const code = strip(up).split('\n').filter((l) => !/^drop function if exists/.test(l)).join('\n');
  assert.doesNotMatch(code, /709221536/);
  assert.doesNotMatch(code, /_admin_did_refuse_protected\(|_admin_did_is_protected\(p/);
  assert.doesNotMatch(code, /42501/);
});

test('each RPC is the applied body minus only the refusal calls', () => {
  const src = { admin_restore_business_number: v1, admin_lift_quarantine: v1, admin_move_number: v11 };
  for (const fn of Object.keys(FNS)) {
    const before = body(src[fn], fn).replace(/\n[ \t]*perform public\._admin_did_refuse_protected\([^)]*\);/g, '');
    assert.equal(body(up, fn), before, fn);
    assert.match(body(up, fn), /security definer/, fn);
    assert.match(body(up, fn), /_package_editor_actor\(p_actor, p_reason\)/, fn);
    assert.match(body(up, fn), /_billing_audit\(/, fn);
  }
});

test('helpers dropped after the RPCs are replaced; last9 kept', () => {
  const code = strip(up);
  const lastCreate = code.lastIndexOf('create or replace function');
  assert.ok(code.indexOf('drop function if exists public._admin_did_refuse_protected(text);') > lastCreate);
  assert.ok(code.indexOf('drop function if exists public._admin_did_is_protected(text);') > lastCreate);
  assert.doesNotMatch(code, /drop function if exists public\._admin_did_last9/);
});

test('grants: explicit revoke from public, anon, authenticated; service_role only', () => {
  for (const [fn, args] of Object.entries(FNS)) {
    assert.match(up, new RegExp(`revoke all on function public\\.${fn}\\(${args}\\) from public, anon, authenticated;`), fn);
    assert.match(up, new RegExp(`grant execute on function public\\.${fn}\\(${args}\\) to service_role;`), fn);
  }
  assert.doesNotMatch(strip(up), /^grant [^\n]* to (anon|authenticated|public)\b/m);
});

test('down restores the refusal: helpers + all three RPCs with refusal calls, service_role only', () => {
  assert.equal(body(down, '_admin_did_is_protected'), body(v1, '_admin_did_is_protected'));
  assert.equal(body(down, '_admin_did_refuse_protected'), body(v1, '_admin_did_refuse_protected'));
  assert.equal(body(down, 'admin_restore_business_number'), body(v1, 'admin_restore_business_number'));
  assert.equal(body(down, 'admin_lift_quarantine'), body(v1, 'admin_lift_quarantine'));
  assert.equal(body(down, 'admin_move_number'), body(v11, 'admin_move_number'));
  for (const fn of ['_admin_did_is_protected', '_admin_did_refuse_protected', ...Object.keys(FNS)]) {
    assert.match(down, new RegExp(`revoke all on function public\\.${fn}\\(`), fn);
    assert.match(down, new RegExp(`grant execute on function public\\.${fn}\\(`), fn);
  }
});

test('DB-only: no billing, wallet, SautiKit, table drops or deletes', () => {
  const code = strip(up);
  assert.doesNotMatch(code, /billing_enforcement\s*=|wallet_balance_kes\s*=|net\.http|http_post|drop\s+table|truncate|delete\s+from/i);
});
