'use strict';
// A 24-hour visit time ("2026-10-26 14:00") must be saved with its time, not day-only.
// Real case: DnD staging call 2026-10-25, "Monday 2 PM" read back, saved as the day only.
const test = require('node:test');
const assert = require('node:assert');
const { validateCreateAppointment } = require('../src/conversation/toolExecution');
const { clockPhrase } = require('../src/conversation/visitTime');

const NOW = new Date('2026-10-25T07:00:00Z'); // Sun 25 Oct 2026, 10:00 EAT
const save = (when) =>
  validateCreateAppointment(
    { service: 'Carpet cleaning', name: 'Alvin', location: 'Kileleshwa', when_text: when },
    { now: NOW }
  );

const cases = [
  ['2026-10-26 14:00', 'Monday 26 October 2026, 2 PM', '2026-10-26T11:00:00.000Z'],
  ['Monday 14:00', 'Monday 26 October 2026, 2 PM', '2026-10-26T11:00:00.000Z'],
  ['Monday 09:30', 'Monday 26 October 2026, 9:30 AM', '2026-10-26T06:30:00.000Z'],
  ['2026-10-26 12:00', 'Monday 26 October 2026, 12 PM', '2026-10-26T09:00:00.000Z'],
  ['2026-10-26 00:00', 'Monday 26 October 2026, 12 AM', '2026-10-25T21:00:00.000Z'],
  ['2026-10-26 2pm', 'Monday 26 October 2026, 2 PM', '2026-10-26T11:00:00.000Z'],
  ['Monday at 2 PM', 'Monday 26 October 2026, 2 PM', '2026-10-26T11:00:00.000Z'],
  ['2026-10-26 12am', 'Monday 26 October 2026, 12 AM', '2026-10-25T21:00:00.000Z'],
];
for (const [when, text, start] of cases) {
  test(`saves time for "${when}"`, () => {
    const r = save(when);
    assert.strictEqual(r.valid, true);
    assert.strictEqual(r.value.whenText, text);
    assert.strictEqual(r.value.windowStart, start);
  });
}

test('day-only stays day-only', () => {
  for (const when of ['tomorrow', '2026-10-26', 'Monday']) {
    const r = save(when);
    assert.strictEqual(r.valid, true);
    assert.strictEqual(r.value.windowStart, '');
  }
});

test('clockPhrase: 24h maps to the same form as 12h; dates and junk do not', () => {
  assert.strictEqual(clockPhrase('14:00'), clockPhrase('2pm'));
  assert.strictEqual(clockPhrase('Monday 09:30'), '9:30am');
  assert.strictEqual(clockPhrase('00:00'), '12am');
  assert.strictEqual(clockPhrase('12:00'), '12pm');
  assert.strictEqual(clockPhrase('23:59'), '11:59pm');
  assert.strictEqual(clockPhrase('2026-10-26'), '');
  assert.strictEqual(clockPhrase('24:00'), '');
  assert.strictEqual(clockPhrase('10:30:15'), '');
});

test('Swahili context with a 24h clock keeps the time', () => {
  const r = save('Jumatatu 14:00');
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.value.windowStart, '2026-10-26T11:00:00.000Z');
});

test('"saa 8:00" is the Swahili clock, not 8am', () => {
  assert.strictEqual(clockPhrase('leo saa 8:00'), '');
  assert.strictEqual(clockPhrase('kesho 08:00'), '8am');
});
