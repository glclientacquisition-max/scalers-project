const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261018220000_revoke_anon_accept_transfer.sql'),
  'utf8',
);

it('revokes anon and PUBLIC execute on accept and transfer', () => {
  assert.match(sql, /revoke all on function public\.accept_tenant_invite\(text, uuid\) from public, anon/);
  assert.match(
    sql,
    /revoke all on function public\.transfer_tenant_ownership\(uuid, uuid, uuid\) from public, anon/,
  );
});

it('keeps service_role execute and does not grant anon or authenticated', () => {
  assert.match(sql, /grant execute on function public\.accept_tenant_invite\(text, uuid\) to service_role;/);
  assert.match(
    sql,
    /grant execute on function public\.transfer_tenant_ownership\(uuid, uuid, uuid\) to service_role;/,
  );
  assert.doesNotMatch(sql, /to [^;]*\banon\b/);
  assert.doesNotMatch(sql, /to authenticated/);
});

it('does not drop the functions or touch other objects', () => {
  assert.doesNotMatch(sql, /drop\s+function|drop\s+table|truncate|delete\s+from/i);
});
