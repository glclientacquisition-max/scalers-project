// Run: node --test tests/smokeDbTenant.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ensureTenant, SMOKE_DID } = require('../scripts/smoke-db');

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
  it('reuses the smoke DID even when several tenants are active', async () => {
    const supabase = {
      from() {
        return chain({
          maybeSingle: { data: { id: 'smoke-tenant' }, error: null },
          insert() {
            throw new Error('must not insert');
          },
        });
      },
    };
    const id = await ensureTenant(supabase);
    assert.equal(id, 'smoke-tenant');
  });

  it('falls back to the first active tenant without maybeSingle', async () => {
    let didQuery = true;
    const supabase = {
      from() {
        if (didQuery) {
          didQuery = false;
          return chain({
            maybeSingle: { data: null, error: null },
          });
        }
        return chain({
          await: {
            data: [{ id: 'active-1' }, { id: 'active-2' }],
            error: null,
          },
          insert() {
            throw new Error('must not insert');
          },
        });
      },
    };
    const id = await ensureTenant(supabase);
    assert.equal(id, 'active-1');
  });

  it('inserts the smoke DID only when no tenant exists', async () => {
    let didQuery = true;
    const supabase = {
      from() {
        if (didQuery) {
          didQuery = false;
          return chain({
            maybeSingle: { data: null, error: null },
          });
        }
        return chain({
          await: { data: [], error: null },
          insert(row) {
            assert.equal(row.sautikit_virtual_number, SMOKE_DID);
            return { data: { id: 'new-id' }, error: null };
          },
        });
      },
    };
    const id = await ensureTenant(supabase);
    assert.equal(id, 'new-id');
  });
});
