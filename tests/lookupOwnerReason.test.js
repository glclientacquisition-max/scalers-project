'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ownerLookupReason, LOOKUP_REASON_CODES } = require('../src/knowledge/lookupOwnerReason');

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
});
