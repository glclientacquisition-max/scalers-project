// Guards attach-column parity: every pool/tenant column that
// assign_specific_did_to_tenant writes when it attaches a number must also be
// written by admin_restore_business_number and admin_move_number (target side).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function fnBody(sql, name) {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const open = sql.indexOf('$$', start);
  return sql.slice(open + 2, sql.indexOf('$$;', open + 2));
}

/** Columns in `update public.<table> set ... where <wherePattern>` (first match). */
function setColumns(body, table, wherePattern) {
  const re = new RegExp(`update public\\.${table}\\s+set\\s+([\\s\\S]*?)\\s+where\\s+([^;]*);`, 'g');
  for (const m of body.matchAll(re)) {
    if (!wherePattern.test(m[2])) continue;
    return new Set(
      m[1].split(/,(?![^(]*\))/).map((part) => part.trim().split(/\s*=/)[0].trim()).filter(Boolean),
    );
  }
  assert.fail(`no update of ${table} matching ${wherePattern}`);
}

// Live staging definition of assign_specific_did_to_tenant matches billing_data_layer.sql.
const assignBody = fnBody(read('docs/supabase/billing_data_layer.sql'), 'assign_specific_did_to_tenant');
const v1 = read('supabase/migrations/20261027081642_admin_number_controls_v1.sql');
const v11 = read('supabase/migrations/20261027082533_admin_number_controls_v1_1.sql');
const restoreBody = fnBody(v1, 'admin_restore_business_number');
const moveBody = fnBody(v11, 'admin_move_number');

const ATTACH_POOL = setColumns(assignBody, 'sautikit_did_pool', /e164 = v_e164/);
const ATTACH_TENANT = setColumns(assignBody, 'tenants', /id = p_tenant_id/);

function missing(expected, got) {
  return [...expected].filter((c) => !got.has(c));
}

test('assign_specific_did_to_tenant attach columns are the expected set', () => {
  assert.deepEqual([...ATTACH_POOL].sort(), ['assigned_at', 'quarantine_until', 'quarantined_at', 'status', 'tenant_id']);
  assert.deepEqual([...ATTACH_TENANT].sort(), ['sautikit_virtual_number']);
});

test('attach parity: restore and move (target side) write every column assign_specific writes', () => {
  const restorePool = setColumns(restoreBody, 'sautikit_did_pool', /id = v_row\.id/);
  const restoreTenant = setColumns(restoreBody, 'tenants', /id = p_tenant_id/);
  const movePool = setColumns(moveBody, 'sautikit_did_pool', /id = v_row\.id/);
  const moveTarget = setColumns(moveBody, 'tenants', /id = p_to_tenant/);
  assert.deepEqual(missing(ATTACH_POOL, restorePool), [], 'restore pool');
  assert.deepEqual(missing(ATTACH_TENANT, restoreTenant), [], 'restore tenant');
  assert.deepEqual(missing(ATTACH_POOL, movePool), [], 'move pool');
  assert.deepEqual(missing(ATTACH_TENANT, moveTarget), [], 'move target tenant');
  // Both also clear the win-back flag; neither touches billing columns on the target.
  assert.ok(restorePool.has('winback_hold') && movePool.has('winback_hold'));
  assert.deepEqual([...moveTarget], ['sautikit_virtual_number']);
});

test('v1.1 docs copy matches its migration and only replaces admin_move_number', () => {
  assert.equal(read('docs/supabase/admin_number_controls_v1_1.sql'), v11);
  const created = [...v11.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(created, ['admin_move_number']);
  assert.match(v11, /revoke all on function public\.admin_move_number\(text, uuid, uuid, text, text, boolean\) from public, anon, authenticated;/);
  assert.match(v11, /grant execute on function public\.admin_move_number\(text, uuid, uuid, text, text, boolean\) to service_role;/);
  assert.doesNotMatch(v11, /grant [^;]*to [^;]*\b(anon|authenticated|public)\b/i);
});
