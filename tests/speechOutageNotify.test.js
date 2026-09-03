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

  it('uses a different owner line when reasoning is down', () => {
    const body = buildOwnerOutageBody('Aris Kenya', 'llm');
    assert.equal(
      body,
      'Aris Kenya line is taking names only. Callers are asked for a name so the team can call back.'
    );
    assert.doesNotMatch(body, /[—–]/);
    assert.doesNotMatch(body, /gemini/i);
  });

  it('tracks speech and reasoning cooldowns separately per tenant', async () => {
    const sent = [];
    setSpeechOutageDispatch(async (opts) => {
      sent.push(opts);
      return { channel: 'sms' };
    });
    const profile = { id: 'tenant-a', businessName: 'Shop A' };
    const speech = await noteSpeechOutage({ profile, kind: 'speech' });
    const llm = await noteSpeechOutage({ profile, kind: 'llm' });
    const speechAgain = await noteSpeechOutage({ profile, kind: 'speech' });
    assert.equal(speech.ok, true);
    assert.equal(llm.ok, true);
    assert.equal(speechAgain.reason, 'cooldown');
    assert.equal(sent.length, 2);
    assert.equal(sent[1].body.includes('taking names only'), true);
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
