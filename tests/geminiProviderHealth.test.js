const { describe, it, beforeEach } = require('node:test');
const assert = require('assert');
const {
  noteGeminiProviderError,
  noteGeminiProviderOk,
  getGeminiProviderHealth,
  resetGeminiProviderHealth,
} = require('../src/conversation/geminiProviderHealth');
const { classifyGeminiError } = require('../src/conversation/geminiVoice');

describe('geminiProviderHealth', () => {
  beforeEach(() => {
    resetGeminiProviderHealth();
  });

  it('marks credits depleted as billing and keeps it after a later ok', () => {
    const err = { status: 429, message: 'Your prepayment credits are depleted' };
    noteGeminiProviderError(classifyGeminiError(err), err);
    let health = getGeminiProviderHealth();
    assert.equal(health.billingExhausted, true);
    assert.equal(health.lastError.kind, 'billing');
    noteGeminiProviderOk();
    health = getGeminiProviderHealth();
    assert.equal(health.billingExhausted, true);
    assert.ok(health.lastOkAt);
  });

  it('clears a transient 429 after a successful turn', () => {
    const err = { status: 429, message: 'RESOURCE_EXHAUSTED overloaded' };
    noteGeminiProviderError(classifyGeminiError(err), err);
    assert.equal(getGeminiProviderHealth().billingExhausted, false);
    noteGeminiProviderOk();
    assert.equal(getGeminiProviderHealth().lastError, null);
  });
});
