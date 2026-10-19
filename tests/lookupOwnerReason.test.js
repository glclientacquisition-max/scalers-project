'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ownerLookupReason,
  lookupPreviewPresentation,
  LOOKUP_REASON_CODES,
} = require('../src/knowledge/lookupOwnerReason');

describe('lookupOwnerReason', () => {
  it('maps every known lookup reason code to plain copy without echoing the code', () => {
    const kinds = ['price', 'hours', 'fee', 'pay'];
    for (const code of LOOKUP_REASON_CODES) {
      for (const kind of kinds) {
        const line = ownerLookupReason(kind, { status: 'unconfirmed', reason: code });
        assert.ok(line.length > 8, `${kind}/${code}`);
        assert.doesNotMatch(line, /hash_|no_list|not_confirmed|no_match/);
      }
    }
  });

  it('covers default lookup statuses', () => {
    for (const status of ['found', 'no_data', 'not_on_file', 'not_found_in_list', 'unconfirmed', 'ambiguous']) {
      const line = ownerLookupReason('pay', { status, reason: 'x' });
      assert.ok(line);
      assert.doesNotMatch(line, /hash_|no_list/);
    }
  });

  it('ambiguous price reason is not the add-catalogue line', () => {
    const line = ownerLookupReason('price', { status: 'ambiguous', reason: 'several_matches' });
    assert.match(line, /asked which one/i);
    assert.doesNotMatch(line, /Add items and prices/);
  });

  it('lookup preview presentation hides raw status codes', () => {
    assert.equal(lookupPreviewPresentation('found').stampLabel, 'Will say');
    assert.equal(lookupPreviewPresentation('ambiguous').stampLabel, 'Will ask which one');
    assert.equal(lookupPreviewPresentation('unconfirmed').stampLabel, 'Not confirmed yet');
    assert.equal(lookupPreviewPresentation('no_data').stampLabel, 'Missing');
    for (const status of ['found', 'ambiguous', 'unconfirmed', 'no_data']) {
      const { stampLabel } = lookupPreviewPresentation(status);
      assert.doesNotMatch(stampLabel, /ambiguous|unconfirmed|no_data|found/);
    }
  });
});
