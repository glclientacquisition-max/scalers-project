const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261018180000_revoke_anon_seat_execute.sql'),
  'utf8',
);

it('revokes anon and PUBLIC execute on both seat functions', () => {
  assert.match(sql, /revoke all on function public\.tenant_seats_used\(uuid\) from public, anon/);
  assert.match(sql, /revoke all on function public\.tenant_seat_available\(uuid\) from public, anon/);
});

it('keeps authenticated and service_role execute', () => {
  assert.match(
    sql,
    /grant execute on function public\.tenant_seats_used\(uuid\) to authenticated, service_role/,
  );
  assert.match(
    sql,
    /grant execute on function public\.tenant_seat_available\(uuid\) to authenticated, service_role/,
  );
});

it('does not drop the functions or touch other objects', () => {
  assert.doesNotMatch(sql, /drop\s+function|drop\s+table|truncate|delete\s+from/i);
});
