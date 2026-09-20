// Appointment hours authorization (EAT). Run: node --test tests/appointmentHours.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultHoursSchedule,
  openClosedStatus,
} = require('../src/conversation/businessHours');
const {
  resolveAppointmentWhen,
  parseAbsoluteWhenDate,
  evaluateAppointmentHours,
  classifyInstant,
  formatRequestedWhenLabel,
} = require('../src/conversation/appointmentHours');

const schedule = defaultHoursSchedule();

/** EAT wall clock as a UTC Date (Kenya UTC+3, no DST). */
function eat(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0));
}

// Tuesday 18 Aug 2026 11:00 EAT
const TUE_11 = eat(2026, 8, 18, 11, 0);
// Tuesday 21:00 EAT
const TUE_21 = eat(2026, 8, 18, 21, 0);
// Sunday 16 Aug 2026 21:00 EAT
const SUN_21 = eat(2026, 8, 16, 21, 0);

describe('classifyInstant boundaries (Mon-Sat 08:00-18:00)', () => {
  it('weekday 08:00 is valid (inclusive open)', () => {
    const out = classifyInstant(schedule, eat(2026, 8, 18, 8, 0));
    assert.equal(out.code, 'valid');
    assert.equal(out.valid, true);
  });

  it('weekday 07:59 is outside_hours', () => {
    const out = classifyInstant(schedule, eat(2026, 8, 18, 7, 59));
    assert.equal(out.code, 'outside_hours');
  });

  it('weekday 15:00 is valid', () => {
    assert.equal(classifyInstant(schedule, eat(2026, 8, 18, 15, 0)).code, 'valid');
  });

  it('weekday 17:59 is valid', () => {
    assert.equal(classifyInstant(schedule, eat(2026, 8, 18, 17, 59)).code, 'valid');
  });

  it('weekday 18:00 is outside_hours (exclusive close)', () => {
    assert.equal(classifyInstant(schedule, eat(2026, 8, 18, 18, 0)).code, 'outside_hours');
  });

  it('weekday 18:01 is outside_hours', () => {
    assert.equal(classifyInstant(schedule, eat(2026, 8, 18, 18, 1)).code, 'outside_hours');
  });

  it('weekday 21:00 is outside_hours', () => {
    assert.equal(classifyInstant(schedule, eat(2026, 8, 18, 21, 0)).code, 'outside_hours');
  });

  it('Sunday is closed_day', () => {
    const out = classifyInstant(schedule, eat(2026, 8, 16, 10, 0));
    assert.equal(out.code, 'closed_day');
    assert.equal(out.weekday, 'sun');
  });

  it('uses tenant-specific hours, not the default', () => {
    const custom = {
      timezone: 'Africa/Nairobi',
      location: '',
      days: {
        mon: null,
        tue: { open: '09:00', close: '13:00' },
        wed: null,
        thu: null,
        fri: null,
        sat: null,
        sun: null,
      },
    };
    assert.equal(classifyInstant(custom, eat(2026, 8, 18, 10, 0)).code, 'valid');
    assert.equal(classifyInstant(custom, eat(2026, 8, 18, 15, 0)).code, 'outside_hours');
    assert.equal(classifyInstant(custom, eat(2026, 8, 17, 10, 0)).code, 'closed_day');
  });
});

describe('resolveAppointmentWhen', () => {
  it('parses tomorrow 10 AM', () => {
    const out = resolveAppointmentWhen('tomorrow 10 AM', TUE_11);
    assert.equal(out.ok, true);
    assert.equal(out.weekday, 'wed');
    assert.equal(out.minutesSinceMidnight, 10 * 60);
  });

  it('parses Tuesday 10 AM as this Tuesday', () => {
    const out = resolveAppointmentWhen('Tuesday 10 AM', TUE_11);
    assert.equal(out.ok, true);
    assert.equal(out.weekday, 'tue');
    assert.equal(out.minutesSinceMidnight, 10 * 60);
  });

  it('parses Sunday 9 PM', () => {
    const out = resolveAppointmentWhen('Sunday 9 PM', TUE_11);
    assert.equal(out.ok, true);
    assert.equal(out.weekday, 'sun');
    assert.equal(out.minutesSinceMidnight, 21 * 60);
  });

  it('parses Monday afternoon', () => {
    const out = resolveAppointmentWhen('Monday afternoon', TUE_11);
    assert.equal(out.ok, true);
    assert.equal(out.weekday, 'mon');
    assert.equal(out.minutesSinceMidnight, 14 * 60);
  });

  it('rejects sometime next week', () => {
    assert.equal(resolveAppointmentWhen('sometime next week', TUE_11).ok, false);
  });

  it('rejects next week without a weekday', () => {
    assert.equal(resolveAppointmentWhen('next week', TUE_11).ok, false);
  });

  it('parses now as the current instant', () => {
    const out = resolveAppointmentWhen('now', TUE_21);
    assert.equal(out.ok, true);
    assert.equal(out.isNow, true);
  });

  it('parses absolute DD Mon YYYY instead of today plus time', () => {
    const now = eat(2026, 9, 20, 11, 0);
    const hold = resolveAppointmentWhen('21 Sep 2026 14:00', now);
    assert.equal(hold.ok, true);
    assert.equal(hold.instant.toISOString(), eat(2026, 9, 21, 14, 0).toISOString());
    assert.equal(hold.minutesSinceMidnight, 14 * 60);

    const visit = resolveAppointmentWhen('22 Sep 2026 09:00', now);
    assert.equal(visit.ok, true);
    assert.equal(visit.instant.toISOString(), eat(2026, 9, 22, 9, 0).toISOString());
    assert.notEqual(visit.instant.toISOString(), eat(2026, 9, 20, 9, 0).toISOString());
  });

  it('extracts the calendar day from DD Mon YYYY and similar', () => {
    assert.deepEqual(parseAbsoluteWhenDate('21 Sep 2026 14:00'), {
      year: 2026,
      month: 9,
      day: 21,
    });
    assert.deepEqual(parseAbsoluteWhenDate('22 September 2026 9:00 AM'), {
      year: 2026,
      month: 9,
      day: 22,
    });
    assert.deepEqual(parseAbsoluteWhenDate('2026-09-22 09:00'), {
      year: 2026,
      month: 9,
      day: 22,
    });
    assert.equal(parseAbsoluteWhenDate('Tuesday 10 AM'), null);
  });

  it('parses similar absolute dates (long month, ISO, day-first)', () => {
    const now = eat(2026, 9, 20, 11, 0);
    const longMonth = resolveAppointmentWhen('22 September 2026 9:00 AM', now);
    assert.equal(longMonth.ok, true);
    assert.equal(longMonth.instant.toISOString(), eat(2026, 9, 22, 9, 0).toISOString());

    const iso = resolveAppointmentWhen('2026-09-22 09:00', now);
    assert.equal(iso.ok, true);
    assert.equal(iso.instant.toISOString(), eat(2026, 9, 22, 9, 0).toISOString());

    const dmy = resolveAppointmentWhen('22/09/2026 09:00', now);
    assert.equal(dmy.ok, true);
    assert.equal(dmy.instant.toISOString(), eat(2026, 9, 22, 9, 0).toISOString());
  });
});

describe('evaluateAppointmentHours', () => {
  it('Tuesday 15:00 is valid', () => {
    const out = evaluateAppointmentHours({
      whenText: 'Tuesday 3 PM',
      schedule,
      now: TUE_11,
    });
    assert.equal(out.code, 'valid');
    assert.equal(out.valid, true);
  });

  it('Tuesday 21:00 is outside_hours', () => {
    const out = evaluateAppointmentHours({
      whenText: 'Tuesday 9 PM',
      schedule,
      now: TUE_11,
    });
    assert.equal(out.code, 'outside_hours');
    assert.equal(out.valid, false);
  });

  it('Sunday 9 PM is closed_day', () => {
    const out = evaluateAppointmentHours({
      whenText: 'Sunday 9 PM',
      schedule,
      now: TUE_11,
    });
    assert.equal(out.code, 'closed_day');
    assert.equal(out.nextOpen?.label, 'Monday');
  });

  it('Sunday 10 AM is closed_day', () => {
    const out = evaluateAppointmentHours({
      whenText: 'Sunday 10 AM',
      schedule,
      now: TUE_11,
    });
    assert.equal(out.code, 'closed_day');
  });

  it('call Sunday 21:00 requesting Tuesday 10 AM is valid', () => {
    const out = evaluateAppointmentHours({
      whenText: 'Tuesday 10 AM',
      schedule,
      now: SUN_21,
    });
    assert.equal(out.code, 'valid');
    assert.equal(out.resolved.weekday, 'tue');
  });

  it('call Sunday 21:00 requesting now is currently_closed', () => {
    const out = evaluateAppointmentHours({
      whenText: 'now',
      schedule,
      now: SUN_21,
    });
    assert.equal(out.code, 'currently_closed');
  });

  it('call Tuesday 21:00 requesting now is currently_closed', () => {
    const out = evaluateAppointmentHours({
      whenText: 'now',
      schedule,
      now: TUE_21,
    });
    assert.equal(out.code, 'currently_closed');
  });

  it('call Tuesday 21:00 requesting tomorrow 10 AM is valid', () => {
    const out = evaluateAppointmentHours({
      whenText: 'tomorrow 10 AM',
      schedule,
      now: TUE_21,
    });
    assert.equal(out.code, 'valid');
    assert.equal(out.resolved.weekday, 'wed');
  });

  it('sometime next week is unparsed_when', () => {
    const out = evaluateAppointmentHours({
      whenText: 'sometime next week',
      schedule,
      now: TUE_11,
    });
    assert.equal(out.code, 'unparsed_when');
    assert.equal(out.valid, false);
  });

  it('formats requested when in Kiswahili weekday names', () => {
    const out = evaluateAppointmentHours({
      whenText: 'Tuesday 10 AM',
      schedule,
      now: TUE_11,
    });
    assert.equal(formatRequestedWhenLabel(out, 'en'), 'Tuesday at 10 AM');
    assert.equal(formatRequestedWhenLabel(out, 'sw'), 'Jumanne, 10 AM');
    assert.equal(formatRequestedWhenLabel(out, 'mixed'), 'Jumanne, 10 AM');
  });
});

describe('openClosedStatus still means now only', () => {
  it('Tuesday 11:00 is open', () => {
    assert.equal(openClosedStatus(schedule, TUE_11), 'open');
  });

  it('Tuesday 21:00 is closed', () => {
    assert.equal(openClosedStatus(schedule, TUE_21), 'closed');
  });

  it('Sunday 21:00 is closed', () => {
    assert.equal(openClosedStatus(schedule, SUN_21), 'closed');
  });
});
