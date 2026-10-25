// Run: node --test tests/alertTypeChoices.test.js
// Per-alert-type choices (notify_channels.by_type). Brief: plans/2026-10-25-alert-type-grid.md.
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseNotifyChannels,
  parseAlertTypes,
  effectiveChannels,
  alertTypeFor,
  ALERT_TYPE_DEFAULTS,
} = require('../src/notifications/notifyChannels');

describe('parseAlertTypes / effectiveChannels', () => {
  it('missing by_type takes the new defaults (existing owners too)', () => {
    const t = parseAlertTypes({ sms: true, whatsapp: true, email: true });
    assert.deepEqual(t.missed_call, { push: true, sms: true, whatsapp: true, email: true });
    assert.deepEqual(t.booking, { push: true, sms: false, whatsapp: true, email: true });
    assert.deepEqual(t.message, { push: false, sms: false, whatsapp: true, email: true });
    assert.deepEqual(parseAlertTypes(null), ALERT_TYPE_DEFAULTS);
  });

  it('partial cells: stored wins, the rest default', () => {
    const t = parseAlertTypes({ by_type: { booking: { sms: true }, message: { email: false } } });
    assert.equal(t.booking.sms, true);
    assert.equal(t.booking.whatsapp, true);
    assert.equal(t.message.email, false);
    assert.equal(t.message.whatsapp, true);
  });

  it('master off masks the column', () => {
    const e = effectiveChannels({ sms: true, whatsapp: false, email: true }, 'booking');
    assert.deepEqual(e, { push: true, sms: false, whatsapp: false, email: true });
  });

  it('no alert type = master switches only (wallet/ops unchanged)', () => {
    assert.deepEqual(effectiveChannels({ sms: true, whatsapp: true, email: true }, null), {
      sms: true, whatsapp: true, email: true, push: true,
    });
  });

  it('missed calls keep one channel even if every cell is off', () => {
    const raw = { by_type: { missed_call: { push: false, sms: false, whatsapp: false, email: false } } };
    const e = effectiveChannels(raw, 'missed_call');
    assert.equal(e.whatsapp, true);
    assert.equal(Object.values(e).filter(Boolean).length, 1);
  });

  it('junk input never throws', () => {
    for (const raw of [undefined, 'x', 3, [], { by_type: 'x' }, { by_type: { booking: 'y' } }]) {
      assert.doesNotThrow(() => effectiveChannels(raw, 'booking'));
      assert.deepEqual(parseAlertTypes(raw).booking, ALERT_TYPE_DEFAULTS.booking);
    }
  });

  it('parseNotifyChannels carries by_type + push through tenantProfile', () => {
    const p = parseNotifyChannels({ sms: true, push: false, by_type: { booking: { sms: true } } });
    assert.equal(p.push, false);
    assert.deepEqual(p.by_type, { booking: { sms: true } });
    assert.equal(effectiveChannels(p, 'booking').sms, true);
  });

  it('maps kinds and outcomes to types', () => {
    assert.equal(alertTypeFor({ kind: 'call_summary', outcome: 'missed' }), 'missed_call');
    assert.equal(alertTypeFor({ kind: 'call_summary', outcome: 'abandoned' }), 'missed_call');
    assert.equal(alertTypeFor({ kind: 'call_summary', outcome: 'booked' }), 'booking');
    assert.equal(alertTypeFor({ kind: 'call_summary', outcome: 'callback_needed' }), 'message');
    assert.equal(alertTypeFor({ kind: 'call_summary', outcome: 'escalated' }), null);
    assert.equal(alertTypeFor({ kind: 'call_summary', answered: false }), 'missed_call');
    assert.equal(alertTypeFor({ kind: 'appointment' }), 'booking');
    assert.equal(alertTypeFor({ kind: 'lead', status: 'no_answer' }), 'missed_call');
    assert.equal(alertTypeFor({ kind: 'lead', status: 'completed' }), null);
    assert.equal(alertTypeFor({ kind: 'call_summary', outcome: 'info_only' }), null, 'answered enquiry keeps today\'s channels');
    assert.equal(alertTypeFor({ kind: 'caller_callback' }), 'message');
    assert.equal(alertTypeFor({ kind: 'wallet_low' }), null);
  });

  it('fixture parity: TS lib imports the same JSON as the backend', () => {
    const fs = require('node:fs');
    const ts = fs.readFileSync(require.resolve('../dashboard/src/lib/notifyChannels.ts'), 'utf8');
    assert.match(ts, /from "\.\/alertTypeDefaults\.json"/);
    assert.doesNotMatch(ts, /missed_call:\s*\{\s*push:/, 'defaults must not be re-declared in TS');
  });
});

describe('dispatchAlert honours the alert type', () => {
  const envKeys = ['TEXTSMS_API_KEY', 'TEXTSMS_PARTNER_ID', 'TEXTSMS_SHORTCODE', 'TEXTSMS_API_URL',
    'SAUTIKIT_API_KEY', 'SAUTIKIT_WHATSAPP_NUMBER_ID', 'RESEND_API_KEY', 'ALERT_EMAIL_FROM'];
  let saved = {};
  let smsPosts = 0;
  beforeEach(() => {
    saved = {};
    for (const k of envKeys) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.TEXTSMS_API_KEY = 'k';
    process.env.TEXTSMS_PARTNER_ID = '1';
    process.env.TEXTSMS_SHORTCODE = 'SCALERS';
    smsPosts = 0;
    mock.method(global, 'fetch', async () => {
      smsPosts += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ responses: [{ 'respose-code': 200, 'response-description': 'Success', mobile: '254740442943', messageid: 1 }] }) };
    });
  });
  afterEach(() => {
    mock.restoreAll();
    for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
  const { dispatchAlert } = require('../src/notifications/dispatch');
  const base = { to: '0740442943', body: 'x', channels: { sms: true, whatsapp: true, email: true } };

  it('booking never uses SMS by default, even when it is the only ready sender', async () => {
    const r = await dispatchAlert({ ...base, alertType: 'booking' });
    assert.equal(smsPosts, 0);
    assert.equal(r.channel, null);
  });

  it('message never uses SMS by default', async () => {
    await dispatchAlert({ ...base, alertType: 'message' });
    assert.equal(smsPosts, 0);
  });

  it('missed call still sends SMS', async () => {
    const r = await dispatchAlert({ ...base, alertType: 'missed_call' });
    assert.equal(smsPosts, 1);
    assert.equal(r.channel, 'sms');
  });

  it('no alert type (wallet) keeps master-only behaviour', async () => {
    const r = await dispatchAlert({ ...base });
    assert.equal(r.channel, 'sms');
  });

  it('owner turned booking SMS on: it sends', async () => {
    const r = await dispatchAlert({ ...base, channels: { ...base.channels, by_type: { booking: { sms: true } } }, alertType: 'booking' });
    assert.equal(r.channel, 'sms');
  });
});
