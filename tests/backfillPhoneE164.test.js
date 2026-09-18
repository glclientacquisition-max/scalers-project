const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeContactPhone,
  planPhoneRewrites,
} = require('../scripts/backfill-phone-e164');

describe('backfill-phone-e164 planner', () => {
  it('rewrites 254 and local 0 numbers to E.164', () => {
    assert.equal(normalizeContactPhone('254712345678'), '+254712345678');
    assert.equal(normalizeContactPhone('0712345678'), '+254712345678');
    assert.equal(normalizeContactPhone('+254712345678'), '+254712345678');
  });

  it('plans updates only when the stored value differs', () => {
    const plan = planPhoneRewrites(
      [
        { id: '1', caller_number: '254712345678' },
        { id: '2', caller_number: '+254700000001' },
        { id: '3', caller_number: 'unknown' },
      ],
      'caller_number'
    );
    assert.equal(plan.scanned, 3);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].id, '1');
    assert.equal(plan.updates[0].to, '+254712345678');
    assert.equal(plan.already, 2);
  });
});
