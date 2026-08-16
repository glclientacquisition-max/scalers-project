// Hours schedule parse + open-now (regression). Run: node --test tests/businessHours.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultHoursSchedule,
  parseHoursSchedule,
  openClosedStatus,
} = require('../src/conversation/businessHours');

function eat(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0));
}

describe('parseHoursSchedule', () => {
  it('rejects overnight open >= close (not supported)', () => {
    const parsed = parseHoursSchedule({
      days: { mon: { open: '22:00', close: '06:00' } },
    });
    assert.equal(parsed, null);
  });

  it('keeps one open/close window per day', () => {
    const parsed = parseHoursSchedule(defaultHoursSchedule());
    assert.equal(parsed.days.mon.open, '08:00');
    assert.equal(parsed.days.mon.close, '18:00');
    assert.equal(parsed.days.sun, null);
  });
});

describe('openClosedStatus (now only)', () => {
  const schedule = defaultHoursSchedule();

  it('is open at 08:00 and closed at 18:00', () => {
    assert.equal(openClosedStatus(schedule, eat(2026, 8, 18, 8, 0)), 'open');
    assert.equal(openClosedStatus(schedule, eat(2026, 8, 18, 18, 0)), 'closed');
  });
});
