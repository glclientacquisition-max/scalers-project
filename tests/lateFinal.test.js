// A final that lands just after a caller turn closes stays for the next turn.
// Run: node --test tests/lateFinal.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createLateFinalHold } = require('../src/speech/lateFinal');

describe('late final hold', () => {
  it('keeps a grace final 137ms after close and merges it into the next turn', () => {
    const hold = createLateFinalHold({ windowMs: 400 });
    hold.noteClosed(1000);
    assert.equal(hold.hold('Kuru?', { now: 1137, reason: 'grace' }), true);
    assert.equal(hold.peek(), 'Kuru?');
    assert.equal(hold.merge('Like, mnafika na.'), 'Kuru? Like, mnafika na.');
    assert.equal(hold.peek(), '');
  });

  it('does not keep a final outside the window, or an echo, or a backchannel', () => {
    const hold = createLateFinalHold({ windowMs: 400 });
    hold.noteClosed(1000);
    assert.equal(hold.hold('Kuru?', { now: 1500, reason: 'grace' }), false);
    assert.equal(hold.hold('hello', { now: 1100, reason: 'echo' }), false);
    assert.equal(hold.hold('hmm', { now: 1100, reason: 'backchannel' }), false);
    assert.equal(hold.hold('later', { now: 1100, reason: 'ignore' }), true);
    assert.equal(hold.merge(''), 'later');
  });

  it('does not prepend a token the next turn already contains', () => {
    const hold = createLateFinalHold({ windowMs: 400 });
    hold.noteClosed(1000);
    hold.hold('Kuru?', { now: 1137, reason: 'grace' });
    assert.equal(hold.merge('Like, mnafika na kuru?'), 'Like, mnafika na kuru?');
  });
});
