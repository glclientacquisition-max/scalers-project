const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const root = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'docs', 'supabase', 'revoke_open_table_grants.sql'), 'utf8');
const mig = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261022010000_revoke_open_table_grants.sql'),
  'utf8',
);

// Statements only (comment lines stripped), lower-cased, whitespace collapsed.
const body = (s) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ');

const sql = body(doc);
const tables = 'public.calls, public.contacts, public.tenants, public.service_requests, public.appointments';

it('migration copy matches the docs file', () => {
  assert.equal(body(mig), sql);
});

it('revokes every anon table privilege, including select', () => {
  assert.ok(
    sql.includes(`revoke select, insert, update, delete, truncate, references, trigger on ${tables} from anon;`),
  );
  assert.ok(sql.includes(`revoke maintain on ${tables} from anon, authenticated`));
});

it('revokes authenticated delete, truncate, references, trigger and calls/tenants insert', () => {
  assert.ok(sql.includes(`revoke delete, truncate, references, trigger on ${tables} from authenticated;`));
  assert.ok(sql.includes('revoke insert on public.calls, public.tenants, public.service_requests, public.appointments from authenticated;'));
});

it('keeps Desk column updates, owner select and contacts insert', () => {
  // A table-level UPDATE revoke would also drop the column UPDATE grants.
  assert.doesNotMatch(sql, /revoke[^;]*\bupdate\b[^;]*from authenticated/);
  assert.doesNotMatch(sql, /revoke[^;]*\bselect\b[^;]*from authenticated/);
  assert.doesNotMatch(sql, /revoke[^;]*\binsert\b[^;]*public\.contacts[^;]*from authenticated/);
});

it('grants nothing and touches no data', () => {
  assert.doesNotMatch(sql, /\bgrant\b(?! ?option)/);
  assert.doesNotMatch(sql, /drop\s|delete\s+from|truncate\s+(table\s+)?public|alter\s+table/);
});

it('documents the exact rollback', () => {
  assert.match(doc, /-- {3}grant select, insert, update, delete, truncate, references, trigger on public\.calls, public\.contacts, public\.tenants, public\.service_requests, public\.appointments to anon;/);
  assert.match(doc, /-- {3}grant insert, delete, truncate, references, trigger on public\.calls, public\.contacts, public\.tenants, public\.service_requests, public\.appointments to authenticated;/);
  assert.match(doc, /-- {3}grant maintain on public\.calls, public\.contacts, public\.tenants, public\.service_requests, public\.appointments to anon, authenticated;/);
});
