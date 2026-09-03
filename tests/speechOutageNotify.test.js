const { describe, it, beforeEach } = require('node:test');
const assert = require('assert');
const {
  buildOwnerOutageBody,
  noteSpeechOutage,
  resetSpeechOutageNotify,
  setSpeechOutageDispatch,
} = require('../src/speech/speechOutageNotify');

describe('speechOutageNotify', () => {
  beforeEach(() => {
    resetSpeechOutageNotify();
  });

  it('keeps owner copy stark and voice-generic', () => {
    const body = buildOwnerOutageBody('Done and Dusted Cleaning Services');
    assert.equal(
      body,
      'Done and Dusted Cleaning Services line downtime. Callers heard a short message and were asked to call back.'
    );
    assert.doesNotMatch(body, /[—–]/);
    assert.doesNotMatch(body, /soniox/i);
    assert.doesNotMatch(body, /billing/i);
  });

  it('sends one owner alert per tenant then cools down', async () => {
    const sent = [];
    setSpeechOutageDispatch(async (opts) => {
      sent.push(opts);
      return { channel: 'sms' };
    });
    const profile = {
      id: 'tenant-a',
      businessName: 'Shop A',
      whatsappNumber: '+254700000001',
    };
    const first = await noteSpeechOutage({ profile });
    const second = await noteSpeechOutage({ profile });
    const other = await noteSpeechOutage({
      profile: { id: 'tenant-b', businessName: 'Shop B' },
    });
    assert.equal(first.ok, true);
    assert.equal(second.reason, 'cooldown');
    assert.equal(other.ok, true);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].body.includes('Shop A'), true);
  });
});
