// Unit tests for Scalers Soniox cloned voice resolver.
// Run: node --test tests/sonioxVoice.test.js

const assert = require('assert');
const { describe, it } = require('node:test');
const {
  SCALERS_SONIOX_VOICE_ID,
  resolveSonioxVoice,
  isUuidVoice,
} = require('../src/speech/sonioxVoice');

describe('sonioxVoice', () => {
  it('resolveSonioxVoice returns the Scalers cloned voice UUID', () => {
    assert.equal(resolveSonioxVoice(), SCALERS_SONIOX_VOICE_ID);
    assert.equal(
      SCALERS_SONIOX_VOICE_ID,
      '7b197f3c-84b4-4404-986f-114e4dac1432'
    );
  });

  it('isUuidVoice detects UUID voice ids', () => {
    assert.equal(isUuidVoice(SCALERS_SONIOX_VOICE_ID), true);
    assert.equal(isUuidVoice('Adrian'), false);
    assert.equal(isUuidVoice(''), false);
  });
});
