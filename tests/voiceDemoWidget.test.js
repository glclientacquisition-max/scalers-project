'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { COPY } = require('../dashboard/src/components/marketing/voiceDemo/copy.ts');
const {
  DEMO_MAX_SEC,
  DEMO_STATES,
  formatCountdown,
  stateForTokenFailure,
} = require('../dashboard/src/components/marketing/voiceDemo/machine.ts');

const EXACT = {
  disabled: 'Demo paused.',
  busy: 'All demo lines are busy, try again in a minute.',
  limit: "You've used today's demos.",
};

describe('voice demo widget states', () => {
  for (const state of DEMO_STATES) {
    it(`${state} has English and Kiswahili copy`, () => {
      const en = textFor(state, 'en');
      const sw = textFor(state, 'sw');
      assert.ok(en && en.length > 1, state);
      assert.ok(sw && sw.length > 1, state);
      assert.equal(en.includes('—') || en.includes('–'), false);
      assert.equal(sw.includes('—') || sw.includes('–'), false);
      assert.equal(en.includes('!'), false);
      assert.equal(sw.includes('!'), false);
    });
  }

  it('shows the paused and busy lines from the token contract', () => {
    assert.equal(stateForTokenFailure(503, 'disabled'), 'disabled');
    assert.equal(COPY.en.paused, EXACT.disabled);
    assert.equal(stateForTokenFailure(503, 'busy'), 'busy');
    assert.equal(stateForTokenFailure(503, 'cap'), 'busy');
    assert.equal(COPY.en.busy, EXACT.busy);
    assert.equal(stateForTokenFailure(429, 'limit_daily'), 'limit');
    assert.equal(stateForTokenFailure(429, 'rate'), 'limit');
    assert.equal(COPY.en.limit, EXACT.limit);
    assert.notEqual(stateForTokenFailure(429, 'limit_daily'), 'busy');
    assert.equal(stateForTokenFailure(403, 'origin'), 'error');
    assert.equal(stateForTokenFailure(403, 'turnstile'), 'error');
  });

  it('counts down from three minutes', () => {
    assert.equal(DEMO_MAX_SEC, 180);
    assert.equal(formatCountdown(180), '3:00');
    assert.equal(formatCountdown(65), '1:05');
    assert.equal(formatCountdown(0), '0:00');
  });

  it('does not paint orange or record audio in the widget', () => {
    const dir = path.join(__dirname, '../dashboard/src/components/marketing/voiceDemo');
    const blob = fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
    assert.equal(/MediaRecorder|attention|orange|#[fF]{2}[0-9a-fA-F]{4}/.test(blob), false);
    assert.match(blob, /echoCancellation: true/);
    assert.match(blob, /createHttpDemoAdapter/);
    assert.match(blob, /createMockDemoAdapter/);
  });
});

function textFor(state, lang) {
  const copy = COPY[lang];
  const map = {
    idle: copy.title,
    consent: copy.notice,
    mic_denied: copy.denied,
    connecting: copy.connecting,
    live: copy.live,
    ended: copy.ended,
    disabled: copy.paused,
    busy: copy.busy,
    limit: copy.limit,
    error: copy.error,
    unsupported: copy.unsupported,
  };
  return map[state];
}
