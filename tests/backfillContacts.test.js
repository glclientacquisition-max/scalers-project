const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSummaryName,
  normalizeContactPhone,
  planTenantContacts,
} = require('../scripts/backfill-contacts-from-calls');

describe('backfill-contacts-from-calls planner', () => {
  it('groups formats onto one phone and prefers the newest name', () => {
    const plan = planTenantContacts(
      [
        {
          caller_number: '0712345678',
          created_at: '2026-01-01T00:00:00.000Z',
          summary: JSON.stringify({ name: 'Old' }),
        },
        {
          caller_number: '+254712345678',
          created_at: '2026-02-01T00:00:00.000Z',
          summary: JSON.stringify({ name: 'New' }),
        },
        {
          caller_number: 'unknown',
          created_at: '2026-03-01T00:00:00.000Z',
          summary: JSON.stringify({ name: 'Skip' }),
        },
      ],
      []
    );
    assert.equal(plan.scanned, 3);
    assert.equal(plan.distinctPhones, 1);
    assert.equal(plan.skipped, 0);
    assert.deepEqual(plan.create, [{ phone: '+254712345678', name: 'New' }]);
  });

  it('skips phones that already have a contact', () => {
    const plan = planTenantContacts(
      [{ caller_number: '+254712345678', created_at: '2026-01-01T00:00:00.000Z', summary: '{}' }],
      [{ phone: '0712 345 678' }]
    );
    assert.equal(plan.create.length, 0);
    assert.equal(plan.skipped, 1);
  });

  it('parses summary names and drops unknown', () => {
    assert.equal(parseSummaryName('{"name":"Amina"}'), 'Amina');
    assert.equal(parseSummaryName('not-json'), null);
    assert.equal(normalizeContactPhone('unknown'), null);
  });
});
