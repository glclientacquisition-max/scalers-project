// Run: node --test tests/smokeDbTenant.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ensureTenant, SMOKE_TENANT_ID } = require('../scripts/smoke-db');

function chain(result) {
  const q = {
    select() {
      return q;
    },
    eq() {
      return q;
    },
    order() {
      return q;
    },
    limit() {
      return q;
    },
    maybeSingle: async () => result.maybeSingle,
    then(resolve, reject) {
      return Promise.resolve(result.await || result.maybeSingle).then(
        resolve,
        reject
      );
    },
    insert(row) {
      return {
        select() {
          return {
            single: async () => result.insert(row),
          };
        },
      };
    },
  };
  return q;
}

describe('smoke-db ensureTenant', () => {
  it('pins Test Archive Co by id', async () => {
    const seen = [];
    const supabase = {
      from(table) {
        const q = chain({ maybeSingle: { data: { id: SMOKE_TENANT_ID }, error: null } });
        const eq = q.eq;
        q.eq = (col, val) => {
          seen.push([table, col, val]);
          return eq(col, val);
        };
        return q;
      },
    };
    assert.equal(SMOKE_TENANT_ID, '51a6c7c6-72f9-43f7-b6c2-942960029cca');
    const id = await ensureTenant(supabase, SMOKE_TENANT_ID);
    assert.equal(id, SMOKE_TENANT_ID);
    assert.deepEqual(seen, [['tenants', 'id', SMOKE_TENANT_ID]]);
  });

  it('refuses (never falls back, never inserts) when the smoke tenant is missing', async () => {
    const supabase = {
      from() {
        return chain({
          maybeSingle: { data: null, error: null },
          await: { data: [{ id: 'active-1' }], error: null },
          insert() {
            throw new Error('must not insert');
          },
        });
      },
    };
    await assert.rejects(() => ensureTenant(supabase, SMOKE_TENANT_ID), /refusing to write into any other tenant/);
  });
});
