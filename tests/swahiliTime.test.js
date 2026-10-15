'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../src/speech/swahiliTime');

function withFlag(v, fn) {
  const prev = process.env.VOICE_SW_TIME;
  if (v == null) delete process.env.VOICE_SW_TIME; else process.env.VOICE_SW_TIME = v;
  try { return fn(); } finally { if (prev === undefined) delete process.env.VOICE_SW_TIME; else process.env.VOICE_SW_TIME = prev; }
}
const prep = (t) => require('../src/speech/ttsNormalize').prepareForTts(t, { callLanguage: 'sw' }).text;
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sw-time', 'HD_4ec204aafa93.json'), 'utf8'));

test('flag defaults off', () => { withFlag(null, () => assert.equal(S.swTimeEnabled(), false)); });

test('clock: hour minus 6 mod 12, period of day', () => {
  const cases = [[9, 0, 'saa tatu asubuhi'], [7, 0, 'saa moja asubuhi'], [12, 0, 'saa sita mchana'], [14, 0, 'saa nane mchana'],
    [16, 0, 'saa kumi jioni'], [18, 0, 'saa kumi na mbili jioni'], [19, 0, 'saa moja usiku'], [0, 0, 'saa sita usiku'],
    [9, 30, 'saa tatu na nusu asubuhi'], [9, 15, 'saa tatu na robo asubuhi'], [9, 45, 'saa nne kasorobo asubuhi'], [9, 10, 'saa tatu na dakika kumi asubuhi']];
  for (const [h, m, want] of cases) assert.equal(S.speakSwClock(h, m), want, `${h}:${m}`);
});

test('HD_4ec204aafa93 fixtures: OFF byte-identical to staging, ON says saa tatu', () => {
  for (const row of fx.tts) {
    withFlag(null, () => assert.equal(prep(row.original), row.heard));
    withFlag('1', () => assert.equal(prep(row.original), row.expect));
  }
});

test('digits, ranges, half past, digit + Swahili period', () => {
  withFlag('1', () => {
    assert.equal(prep('Saa 9:30 AM.'), 'saa tatu na nusu asubuhi.');
    assert.equal(prep('Tunafungua 8 AM - 5 PM.'), 'Tunafungua saa mbili asubuhi hadi saa kumi na moja jioni.');
    assert.equal(prep('Kesho 9-11 AM inafaa?'), 'Kesho saa tatu hadi saa tano asubuhi inafaa?');
    assert.equal(prep('Tuonane 2 PM.'), 'Tuonane saa nane mchana.');
    assert.equal(prep('saa 9 asubuhi'), 'saa tatu asubuhi');
    assert.equal(prep('Saa 2 asubuhi.'), 'saa mbili asubuhi.', 'western 2 AM is not asubuhi: already Swahili');
    assert.equal(prep('14:00 inafaa.'), 'saa nane mchana inafaa.');
  });
});

test('update_appointment no-change: re-read, never "nimehamisha"', () => {
  const X = require('../src/conversation/toolExecution');
  const { open, update } = fx.dispute;
  withFlag(null, () => assert.equal(X.updateIsNoChange(update, [open]), false, 'off = old path'));
  withFlag('1', () => {
    assert.equal(X.updateIsNoChange(update, [open]), true);
    assert.equal(X.updateIsNoChange({ ...update, windowStart: '2026-10-15T07:00:00.000Z' }, [open]), false, 'a real move');
    assert.equal(X.updateIsNoChange({ ...update, status: 'cancelled' }, [open]), false);
    const line = X.formatToolConfirmation([{ action: 'update_appointment', status: 'unchanged', value: update, hours: null }], 'sw');
    assert.doesNotMatch(line, /nimehamisha/i);
    assert.match(line, /haijabadilika/);
  });
});
