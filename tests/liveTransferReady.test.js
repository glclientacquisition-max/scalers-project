const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeKenyaE164,
  teamHasDialablePhone,
  liveTransferDestination,
  liveTransferReady,
} = require('../src/conversation/liveTransferReady');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');

function openNow() {
  // Monday 10:00 EAT
  return new Date('2026-09-07T07:00:00.000Z');
}

function closedNow() {
  // Sunday 10:00 EAT
  return new Date('2026-09-06T07:00:00.000Z');
}

const profileBase = {
  handoffMode: 'live_transfer',
  agentTools: { escalate: true, end_call: true },
  hoursSchedule: defaultHoursSchedule(),
  teamDirectory: [{ name: 'Amina', role: 'Owner', phone: '0712345678' }],
};

describe('liveTransferReady', () => {
  it('normalizes Kenya mobiles to E.164', () => {
    assert.equal(normalizeKenyaE164('0712 345 678'), '+254712345678');
    assert.equal(normalizeKenyaE164('+254712345678'), '+254712345678');
    assert.equal(normalizeKenyaE164('712345678'), '+254712345678');
    assert.equal(normalizeKenyaE164('not-a-phone'), null);
  });

  it('requires executor, preference, open hours, and a directory phone', () => {
    const ok = liveTransferReady({
      profile: profileBase,
      executorEnabled: true,
      now: openNow(),
    });
    assert.equal(ok.ready, true);

    assert.equal(
      liveTransferReady({ profile: profileBase, executorEnabled: false, now: openNow() })
        .reason,
      'executor_off'
    );
    assert.equal(
      liveTransferReady({
        profile: { ...profileBase, handoffMode: 'callback' },
        executorEnabled: true,
        now: openNow(),
      }).reason,
      'handoff_callback'
    );
    assert.equal(
      liveTransferReady({
        profile: { ...profileBase, teamDirectory: [{ name: 'Amina', role: 'Owner' }] },
        executorEnabled: true,
        now: openNow(),
      }).reason,
      'no_destination'
    );
  });

  it('can ignore hours when VOICE_LIVE_TRANSFER_IGNORE_HOURS is on', () => {
    const prev = process.env.VOICE_LIVE_TRANSFER_IGNORE_HOURS;
    process.env.VOICE_LIVE_TRANSFER_IGNORE_HOURS = 'on';
    try {
      const ok = liveTransferReady({
        profile: profileBase,
        executorEnabled: true,
        now: closedNow(),
      });
      assert.equal(ok.ready, true);
    } finally {
      if (prev == null) delete process.env.VOICE_LIVE_TRANSFER_IGNORE_HOURS;
      else process.env.VOICE_LIVE_TRANSFER_IGNORE_HOURS = prev;
    }
  });

  it('picks a dialable directory destination', () => {
    assert.equal(teamHasDialablePhone(profileBase.teamDirectory), true);
    const dest = liveTransferDestination(profileBase.teamDirectory, 'owner');
    assert.equal(dest.phone, '+254712345678');
    assert.equal(dest.name, 'Amina');
  });
});
