const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeContactIdentity } = require('../src/conversation/contactIdentity');

describe('mergeContactIdentity', () => {
  it('sets the first name as primary', () => {
    const next = mergeContactIdentity(null, { name: 'Amina', callId: 'c1' });
    assert.equal(next.name, 'Amina');
    assert.deepEqual(next.metadata.alternate_names, []);
  });

  it('never lets a null or empty name overwrite a primary', () => {
    const existing = { name: 'Amina', metadata: {} };
    assert.equal(mergeContactIdentity(existing, { name: null }).name, 'Amina');
    assert.equal(mergeContactIdentity(existing, { name: '  ' }).name, 'Amina');
    assert.equal(mergeContactIdentity(existing, {}).name, 'Amina');
  });

  it('logs a differing name as an alternate without changing primary', () => {
    const next = mergeContactIdentity(
      { name: 'Amina', metadata: {} },
      { name: 'Brian', callId: 'c2', seenAt: '2026-09-09T00:00:00.000Z' }
    );
    assert.equal(next.name, 'Amina');
    assert.equal(next.metadata.alternate_names.length, 1);
    assert.equal(next.metadata.alternate_names[0].name, 'Brian');
    assert.equal(next.metadata.alternate_names[0].call_id, 'c2');
  });

  it('treats a matching name as a no-op', () => {
    const next = mergeContactIdentity(
      {
        name: 'Amina',
        metadata: { alternate_names: [{ name: 'Brian', seen_at: 't', call_id: 'c2' }] },
      },
      { name: 'amina' }
    );
    assert.equal(next.name, 'Amina');
    assert.equal(next.metadata.alternate_names.length, 1);
    assert.equal(next.metadata.alternate_names[0].name, 'Brian');
  });

  it('uses a new name as primary when none is set yet', () => {
    const next = mergeContactIdentity({ name: null, metadata: {} }, { name: 'Jane' });
    assert.equal(next.name, 'Jane');
    assert.deepEqual(next.metadata.alternate_names, []);
  });

  it('keeps the 5 most recent distinct alternates', () => {
    let existing = { name: 'Amina', metadata: { alternate_names: [] } };
    for (const name of ['B', 'C', 'D', 'E', 'F', 'G']) {
      existing = {
        name: existing.name,
        metadata: mergeContactIdentity(existing, { name }).metadata,
      };
    }
    const names = existing.metadata.alternate_names.map((row) => row.name);
    assert.equal(names.length, 5);
    assert.deepEqual(names, ['G', 'F', 'E', 'D', 'C']);
  });
});
