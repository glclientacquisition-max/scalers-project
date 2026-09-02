// Soniox error classification — 402 billing is the silent-answer failure.
const { describe, it } = require('node:test');
const assert = require('assert');
const {
  classifySonioxError,
  isSonioxBillingError,
} = require('../src/speech/sonioxErrors');
const {
  noteSonioxProviderError,
  noteSonioxProviderOk,
  getSonioxProviderHealth,
  resetSonioxProviderHealth,
} = require('../src/speech/sonioxProviderHealth');

describe('classifySonioxError', () => {
  it('detects 402 organization balance exhausted', () => {
    const c = classifySonioxError({
      error_code: 402,
      error_message:
        'Organization balance exhausted. Please either add funds manually or enable autopay.',
    });
    assert.equal(c.billing, true);
    assert.equal(c.fatal, true);
    assert.equal(c.code, 402);
    assert.equal(isSonioxBillingError(c.message), true);
  });

  it('detects billing from Error.message without a numeric code', () => {
    const c = classifySonioxError(
      new Error('Organization balance exhausted. Please either add funds manually or enable autopay.')
    );
    assert.equal(c.billing, true);
  });

  it('does not mark ordinary stream-not-found as billing', () => {
    const c = classifySonioxError({
      error_code: 400,
      error_message: 'Stream tts-abc not found. Send a start message first.',
    });
    assert.equal(c.billing, false);
    assert.equal(c.fatal, false);
    assert.equal(c.code, 400);
  });
});

describe('sonioxProviderHealth', () => {
  it('keeps billing 402 and ignores a later 400 on the same channel', () => {
    resetSonioxProviderHealth();
    noteSonioxProviderError(
      'tts',
      classifySonioxError({
        error_code: 402,
        error_message: 'Organization balance exhausted.',
      })
    );
    noteSonioxProviderError(
      'tts',
      classifySonioxError({
        error_code: 400,
        error_message: 'Stream not found.',
      })
    );
    const health = getSonioxProviderHealth();
    assert.equal(health.billingExhausted, true);
    assert.equal(health.tts.code, 402);
    noteSonioxProviderOk('tts');
    assert.equal(getSonioxProviderHealth().billingExhausted, false);
    resetSonioxProviderHealth();
  });
});
