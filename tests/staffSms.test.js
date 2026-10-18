// Run: node --test tests/staffSms.test.js
// Owner and staff call-alert SMS (lead, escalation, service request, visit,
// voicemail, callback) must fit one GSM-7 segment: 160 characters, basic GSM
// characters only (an emoji, curly quote or en dash switches to UCS-2 = 70).
// WhatsApp and email keep the full text. Never imply a transfer or a booking.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { renderStaffSms, toGsm7, isGsm7Basic, SMS_MAX } = require('../src/notifications/templates');
const { smsSegments, resetInstanceFlights } = require('../src/notifications/sendLedger');

const CALL_ID = '3f2b9c1e-7a4d-4e8b-9c21-5d6e7f8a9b0c';
const LONG_BIZ = 'Mama Njeri Gas & Hardware Supplies and General Merchants Ltd';
const LONG_NAME = 'Wanjiku \u201cShiru\u201d Kamau-Njoroge Wa Mwangi \ud83d\ude00';
const LONG_REASON =
  'Wants a 13kg gas refill delivered to Kahawa West today \u2013 asked about the price of a new regulator, ' +
  'a hose, and whether you deliver on Sunday \ud83d\ude4f\u2026 also said \u2018call me after 5\u2019 [urgent] {asap} ~ ^ | \\ \u20ac';
const PHONE = '+254712345678';

const WORST = {
  lead: { kind: 'lead', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: LONG_REASON, callerNumber: PHONE } },
  escalation: { kind: 'escalation', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: LONG_REASON, callerNumber: PHONE } },
  enquiry: { kind: 'service_request', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: `ENQUIRY: ${LONG_REASON}. This afternoon`, callerNumber: PHONE } },
  hold: { kind: 'service_request', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: `HOLD / PICKUP: ${LONG_REASON}`, callerNumber: PHONE } },
  order: { kind: 'service_request', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: `ORDER: ${LONG_REASON}`, callerNumber: PHONE } },
  callback: { kind: 'service_request', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: `CALLBACK: ${LONG_REASON}`, callerNumber: PHONE } },
  visit: { kind: 'appointment', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: `VISIT REQUEST: Gas cooker installation. ${LONG_REASON}`, callerNumber: PHONE } },
  visitUpdated: { kind: 'appointment', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: `VISIT UPDATED: ${LONG_REASON}`, callerNumber: PHONE } },
  visitCancelled: { kind: 'appointment', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: `VISIT CANCELLED: ${LONG_REASON}`, callerNumber: PHONE } },
  voicemail: { kind: 'voicemail', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: LONG_REASON, callerNumber: PHONE } },
  callbackKind: { kind: 'callback', lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: LONG_REASON, callerNumber: PHONE } },
};

describe('toGsm7 / isGsm7Basic', () => {
  it('maps curly quotes, dashes, ellipsis and drops emoji and GSM extension chars', () => {
    const out = toGsm7('\u201cHi\u201d \u2013 it\u2019s ok\u2026 \ud83d\ude00 [a] {b} ~^|\\\u20ac caf\u00e9');
    assert.equal(out, '"Hi" - it\'s ok... (a) (b) -//EUR cafe');
    assert.equal(isGsm7Basic(out), true);
    assert.equal(isGsm7Basic('\u201cx\u201d'), false);
    assert.equal(isGsm7Basic('a{b'), false, 'extension chars count double; not allowed');
  });
});

describe('renderStaffSms: realistic worst case stays in one GSM-7 segment', () => {
  for (const [name, spec] of Object.entries(WORST)) {
    for (const withLink of [true, false]) {
      it(`${name}${withLink ? ' + Desk link' : ''}`, () => {
        const sms = renderStaffSms({ ...spec, callId: withLink ? CALL_ID : null, deskBase: 'https://app.scalers.co.ke' });
        assert.ok(sms.length <= SMS_MAX, `${sms.length} > 160:\n${sms}`);
        assert.equal(isGsm7Basic(sms), true, sms);
        assert.equal(smsSegments(sms), 1);
        assert.ok(sms.includes(PHONE), 'caller number kept');
        assert.match(sms, /Mama Njeri/, 'business kept (maybe clipped)');
        assert.match(sms, /Wanjiku/, 'caller name kept (maybe clipped)');
        const lines = sms.split('\n');
        // Detail (what they want) wins over the 60-char link: link kept only
        // while the detail still has 50+ chars.
        if (withLink && sms.includes('/calls/')) assert.ok(lines.length === 3 || lines[2].length >= 45, sms);
        if (!sms.includes('/calls/')) assert.ok(lines[2].length >= 60, `detail too short:\n${sms}`);
        assert.doesNotMatch(sms, /transfer|connect|confirmed|booked|https?:\/\//i);
      });
    }
  }
});

describe('renderStaffSms: wording and typical alerts', () => {
  const link = { callId: CALL_ID, deskBase: 'https://app.scalers.co.ke/' };
  it('typical lead keeps every field in full', () => {
    const sms = renderStaffSms({
      kind: 'lead',
      lead: { businessName: 'Mama Njeri Gas', name: 'Wanjiku Kamau', reason: 'Wants a 13kg gas refill today', callerNumber: PHONE },
      ...link,
    });
    assert.equal(sms, `Missed call - Mama Njeri Gas\nWanjiku Kamau ${PHONE}\nWants a 13kg gas refill today\napp.scalers.co.ke/calls/${CALL_ID}`);
  });
  it('labels: callbacks and visits to confirm, never a booking or transfer', () => {
    const lab = (kind, reason) => renderStaffSms({ kind, lead: { businessName: 'B', name: 'N', reason, callerNumber: PHONE } }).split('\n')[0];
    assert.equal(lab('escalation', 'refund'), 'Call back - B');
    assert.equal(lab('service_request', 'ENQUIRY: price'), 'Enquiry - B');
    assert.equal(lab('service_request', 'HOLD / PICKUP: cylinder'), 'Hold request - B');
    assert.equal(lab('service_request', 'ORDER: cylinder'), 'Order request - B');
    assert.equal(lab('service_request', 'CALLBACK: refund'), 'Callback request - B');
    assert.equal(lab('appointment', 'VISIT REQUEST: install'), 'Visit request, to confirm - B');
    assert.equal(lab('appointment', 'VISIT UPDATED: install'), 'Visit changed, to confirm - B');
    assert.equal(lab('appointment', 'VISIT CANCELLED: install'), 'Visit cancelled - B');
    assert.equal(lab('voicemail', 'msg'), 'Voicemail - B');
    assert.equal(lab('callback', 'x'), 'Callback request - B');
  });
  it('the title prefix is not repeated in the detail line', () => {
    const sms = renderStaffSms({ kind: 'service_request', lead: { businessName: 'B', name: 'N', reason: 'ENQUIRY: 6kg refill. Today', callerNumber: PHONE } });
    assert.equal(sms, `Enquiry - B\nN ${PHONE}\n6kg refill. Today`);
  });
  it('missing reason or name: no empty labels', () => {
    const sms = renderStaffSms({ kind: 'lead', lead: { businessName: 'B', callerNumber: PHONE } });
    assert.equal(sms, `Missed call - B\nCaller ${PHONE}`);
  });
  it('not a staff call alert: null (caller, billing, wallet keep their text)', () => {
    for (const kind of ['caller_callback', 'missed_textback', 'platform_billing_suspended', 'wallet_low', 'outage_speech']) {
      assert.equal(renderStaffSms({ kind, lead: { businessName: 'B', name: 'N', reason: 'r', callerNumber: PHONE } }), null, kind);
    }
  });
});

describe('dispatchAlert: SMS gets the short body, WhatsApp/email keep the full text', () => {
  const ENV = { TEXTSMS_API_KEY: 'k', TEXTSMS_PARTNER_ID: '1', TEXTSMS_SHORTCODE: 'TEST' };
  let saved;
  let realFetch;
  afterEach(() => {
    for (const [k, v] of Object.entries(saved || {})) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (realFetch) global.fetch = realFetch;
    resetInstanceFlights();
  });

  function setup() {
    saved = {};
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const sent = [];
    realFetch = global.fetch;
    global.fetch = async (url, init) => {
      sent.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ responses: [{ 'response-code': 200, messageid: 'm1', mobile: '254712345678' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    return sent;
  }

  it('lead SMS is the one-segment body', async () => {
    const sent = setup();
    const { dispatchAlert } = require('../src/notifications/dispatch');
    const full = `New missed-call lead. ${LONG_BIZ}\nName: ${LONG_NAME}\nPhone: ${PHONE}\nReason: ${LONG_REASON}`;
    const out = await dispatchAlert({
      to: PHONE,
      body: full,
      lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: LONG_REASON, callerNumber: PHONE },
      kind: 'lead',
      channels: { sms: true, whatsapp: false, email: false },
    });
    assert.equal(out.channel, 'sms');
    const msg = sent.find((s) => s.body && s.body.message).body.message;
    assert.ok(msg.length <= 160, msg);
    assert.equal(isGsm7Basic(msg), true);
    assert.match(msg, /^Missed call - /);
  });

  it('a non-alert kind (wallet) keeps its full text on SMS', async () => {
    const sent = setup();
    const { dispatchAlert } = require('../src/notifications/dispatch');
    const body = 'Scalers wallet running low. B\nBalance KES 120.';
    await dispatchAlert({ to: PHONE, body, kind: 'wallet_low', channels: { sms: true, whatsapp: false, email: false } });
    assert.equal(sent.find((s) => s.body && s.body.message).body.message, body);
  });
});
