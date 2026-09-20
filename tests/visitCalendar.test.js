const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  eatYmd,
  mondayYmd,
  shiftWeekYmd,
  weekDayKeys,
  visitDayKey,
  stampScheduleWindows,
  groupVisitsByDay,
  formatOpenVisitsForPrompt,
} = require('../src/conversation/visitCalendar');

function eat(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0));
}

describe('visit calendar', () => {
  it('starts the week on Monday in EAT', () => {
    const wednesday = eat(2026, 9, 9, 11, 0);
    assert.equal(eatYmd(wednesday), '2026-09-09');
    assert.equal(mondayYmd(wednesday), '2026-09-07');
    const days = weekDayKeys('2026-09-07');
    assert.equal(days[0].key, '2026-09-07');
    assert.equal(days[6].key, '2026-09-13');
  });

  it('shifts weeks by seven EAT days', () => {
    assert.equal(shiftWeekYmd('2026-09-07', 1), '2026-09-14');
    assert.equal(shiftWeekYmd('2026-09-07', -1), '2026-08-31');
  });

  it('places tomorrow visits on the next EAT day', () => {
    const now = eat(2026, 9, 9, 11, 0);
    assert.equal(
      visitDayKey({ when_text: 'tomorrow at 10 AM' }, now),
      '2026-09-10'
    );
  });

  it('groups open visits and skips cancelled', () => {
    const now = eat(2026, 9, 9, 11, 0);
    const monday = mondayYmd(now);
    const grouped = groupVisitsByDay(
      [
        { id: '1', status: 'requested', when_text: 'tomorrow at 10 AM', service_name: 'Carpet' },
        { id: '2', status: 'cancelled', when_text: 'tomorrow at 11 AM', service_name: 'Skip' },
        { id: '3', status: 'confirmed', when_text: '', service_name: 'No time' },
      ],
      monday,
      now
    );
    assert.equal(grouped.byDay['2026-09-10'].length, 1);
    assert.equal(grouped.byDay['2026-09-10'][0].id, '1');
    assert.equal(grouped.unscheduled.length, 1);
    assert.equal(grouped.unscheduled[0].id, '3');
  });

  it('formats open visits for the live prompt', () => {
    const block = formatOpenVisitsForPrompt([
      { when_text: 'Tue 10 AM', service_name: 'Carpet cleaning', status: 'requested' },
      { when_text: 'Wed 2 PM', service_name: 'Sofa', status: 'cancelled' },
    ]);
    assert.match(block, /OPEN VISITS/);
    assert.match(block, /Carpet cleaning/);
    assert.match(block, /Same-hour visits are allowed/);
    assert.doesNotMatch(block, /Sofa/);
  });

  it('stamps when_text with matching window_start and window_end', () => {
    const now = eat(2026, 9, 9, 11, 0);
    const stamped = stampScheduleWindows('tomorrow at 10 AM', now);
    assert.equal(stamped.when_text, 'tomorrow at 10 AM');
    assert.equal(stamped.window_start, eat(2026, 9, 10, 10, 0).toISOString());
    assert.equal(stamped.window_end, stamped.window_start);
  });

  it('clears stale windows when When text cannot be parsed', () => {
    const stamped = stampScheduleWindows('Anytime', eat(2026, 9, 9, 11, 0));
    assert.equal(stamped.when_text, 'Anytime');
    assert.equal(stamped.window_start, null);
    assert.equal(stamped.window_end, null);
  });

  it('keeps desk When+Save on the same absolute parse as resolveAppointmentWhen', () => {
    const fs = require('fs');
    const path = require('path');
    const desk = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/lib/visitCalendar.ts'),
      'utf8'
    );
    assert.match(desk, /export function parseAbsoluteWhenDate/);
    assert.match(desk, /const absolute = parseAbsoluteWhenDate\(text\)/);
    assert.match(
      desk,
      /\\b\(\\d\{1,2\}\)\(\?:st\|nd\|rd\|th\)\?\\s\+\(\[A-Za-z\]\{3,9\}\)\\.\?\\s\+\(\\d\{4\}\)\\b/
    );
    assert.match(desk, /stampScheduleWindows/);
    assert.match(desk, /visitInstant/);
  });

  it('stamps absolute DD Mon YYYY on the written EAT day, not today', () => {
    const now = eat(2026, 9, 20, 11, 0);
    const hold = stampScheduleWindows('21 Sep 2026 14:00', now);
    assert.equal(hold.when_text, '21 Sep 2026 14:00');
    assert.equal(hold.window_start, eat(2026, 9, 21, 14, 0).toISOString());
    assert.equal(hold.window_end, hold.window_start);
    assert.notEqual(hold.window_start, eat(2026, 9, 20, 14, 0).toISOString());

    const visit = stampScheduleWindows('22 Sep 2026 09:00', now);
    assert.equal(visit.window_start, eat(2026, 9, 22, 9, 0).toISOString());
    assert.notEqual(visit.window_start, eat(2026, 9, 20, 9, 0).toISOString());
  });

  it('flags same-hour open visits without treating them as a lock', () => {
    const slot = eat(2026, 9, 8, 10, 0);
    const hours = { resolved: { instant: slot } };
    const { visitOverlapsOpen } = require('../src/conversation/visitCalendar');
    const hit = visitOverlapsOpen(hours, [
      {
        id: 'a',
        status: 'requested',
        window_start: slot.toISOString(),
      },
    ]);
    assert.equal(hit?.code, 'overlap');
    const self = visitOverlapsOpen(
      hours,
      [{ id: 'a', status: 'requested', window_start: slot.toISOString() }],
      slot,
      { ignoreId: 'a' }
    );
    assert.equal(self, null);
  });
});
