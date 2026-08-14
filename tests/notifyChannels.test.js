// Run: node --test tests/notifyChannels.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseNotifyChannels } = require('../src/notifications/notifyChannels');

describe('parseNotifyChannels', () => {
  it('defaults all channels on', () => {
    assert.deepEqual(parseNotifyChannels(null), {
      sms: true,
      whatsapp: true,
      email: true,
    });
  });

  it('honors tenant toggles', () => {
    assert.deepEqual(parseNotifyChannels({ sms: true, whatsapp: false, email: false }), {
      sms: true,
      whatsapp: false,
      email: false,
    });
  });

  it('keeps at least one channel when all off', () => {
    assert.equal(parseNotifyChannels({ sms: false, whatsapp: false, email: false }).sms, true);
  });
});
