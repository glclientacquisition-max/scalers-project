const assert = require('node:assert/strict');
const { it } = require('node:test');
const { trustedToolPhone } = require('../src/conversation/callerPhoneGuard');

it('drops a marker phone the caller never said (falls back to caller ID)', () => {
  assert.equal(trustedToolPhone('+254711000111', ''), undefined);
  assert.equal(trustedToolPhone('+254711000111', '0722000222'), undefined);
});
it('keeps a number the caller spoke, in any Kenyan format', () => {
  assert.equal(trustedToolPhone('+254722000222', '0722 000 222'), '+254722000222');
});
it('no marker phone -> undefined', () => {
  assert.equal(trustedToolPhone('', '0722000222'), undefined);
});
