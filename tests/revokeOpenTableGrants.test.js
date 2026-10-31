const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261022013000_revoke_anon_default_privileges.sql'),
  'utf8',
);
const doc = fs.readFileSync(
  path.join(root, 'docs', 'supabase', 'revoke_anon_default_privileges.sql'),
  'utf8',
);

const live = (sql) =>
  sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

it('docs file and migration are identical', () => {
  assert.equal(migration, doc);
});

it('revokes anon from postgres public defaults for tables, sequences, functions', () => {
  const sql = live(migration);
  for (const kind of ['tables', 'sequences', 'functions']) {
    assert.match(
      sql,
      new RegExp(`alter default privileges for role postgres in schema public\\s+revoke all on ${kind} from anon;`),
    );
  }
});

it('does not touch authenticated, service_role, supabase_admin or existing objects', () => {
  const sql = live(migration);
  assert.doesNotMatch(sql, /authenticated|service_role|supabase_admin/);
  assert.doesNotMatch(sql, /\bgrant\b/i);
  assert.doesNotMatch(sql, /on\s+all\s+(tables|sequences|functions)/i);
  assert.doesNotMatch(sql, /drop\s|truncate|delete\s+from/i);
});

it('ships rollback SQL as comments', () => {
  assert.match(migration, /-- alter default privileges for role postgres in schema public grant all on tables to anon;/);
  assert.match(migration, /-- alter default privileges for role postgres in schema public grant execute on functions to anon;/);
});
