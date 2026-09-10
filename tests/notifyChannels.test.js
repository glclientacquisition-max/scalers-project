// Run: node --test tests/notifyChannels.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseNotifyChannels } = require('../src/notifications/notifyChannels');

describe('parseNotifyChannels', () => {
  it('defaults owner channels on and caller SMS off', () => {
    assert.deepEqual(parseNotifyChannels(null), {
      sms: true,
      whatsapp: true,
      email: true,
      caller_sms: false,
    });
  });

  it('honors tenant toggles', () => {
    assert.deepEqual(parseNotifyChannels({ sms: true, whatsapp: false, email: false }), {
      sms: true,
      whatsapp: false,
      email: false,
      caller_sms: false,
    });
  });

  it('keeps at least one channel when all off', () => {
    assert.equal(parseNotifyChannels({ sms: false, whatsapp: false, email: false }).sms, true);
  });

  it('honors caller SMS opt-in without forcing it on', () => {
    assert.equal(
      parseNotifyChannels({ sms: true, whatsapp: true, email: true, caller_sms: true })
        .caller_sms,
      true
    );
  });
});
