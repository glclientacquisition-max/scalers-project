const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  eatYmd,
  mondayYmd,
  shiftWeekYmd,
  weekDayKeys,
  eatWeekRangeIso,
  visitDayKey,
  visitOverlapsOpen,
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
    assert.doesNotMatch(block, /Sofa/);
  });

  it('builds an EAT Monday–Sunday ISO range', () => {
    const range = eatWeekRangeIso('2026-09-07');
    assert.ok(range);
    assert.equal(range.from, '2026-09-06T21:00:00.000Z');
    assert.equal(range.to, '2026-09-13T21:00:00.000Z');
  });

  it('rejects overlapping open visits on the same EAT hour', () => {
    const slot = eat(2026, 9, 8, 10, 0);
    const hours = { resolved: { instant: slot } };
    const hit = visitOverlapsOpen(hours, [
      {
        status: 'requested',
        when_text: 'Tuesday 10 AM',
        window_start: slot.toISOString(),
      },
    ]);
    assert.equal(hit?.code, 'overlap');
    const miss = visitOverlapsOpen(hours, [
      {
        status: 'requested',
        window_start: eat(2026, 9, 8, 11, 0).toISOString(),
      },
    ]);
    assert.equal(miss, null);
    const cancelled = visitOverlapsOpen(hours, [
      {
        status: 'cancelled',
        window_start: slot.toISOString(),
      },
    ]);
    assert.equal(cancelled, null);
  });
});
