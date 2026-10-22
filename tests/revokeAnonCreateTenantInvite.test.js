const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261018210000_revoke_anon_create_tenant_invite.sql'),
  'utf8',
);

it('revokes anon and PUBLIC execute on create_tenant_invite', () => {
  assert.match(
    sql,
    /revoke all on function public\.create_tenant_invite\(uuid, text, text, text, uuid\) from public, anon/,
  );
});

it('keeps service_role execute and does not grant anon or authenticated', () => {
  assert.match(
    sql,
    /grant execute on function public\.create_tenant_invite\(uuid, text, text, text, uuid\) to service_role;/,
  );
  assert.doesNotMatch(sql, /grant execute on function public\.create_tenant_invite[\s\S]*to [^;]*\banon\b/);
  assert.doesNotMatch(sql, /to authenticated/);
});

it('does not drop the function or touch other objects', () => {
  assert.doesNotMatch(sql, /drop\s+function|drop\s+table|truncate|delete\s+from/i);
});
