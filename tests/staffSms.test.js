// Run: node --test tests/staffSms.test.js
// Owner and staff call-alert SMS (lead, escalation, service request, visit,
// voicemail, callback) must fit one GSM-7 segment: 160 characters, basic GSM
// characters only (an emoji, curly quote or en dash switches to UCS-2 = 70).
// WhatsApp and email keep the full text. Never imply a transfer or a booking.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { renderStaffSms, toGsm7, isGsm7Basic, smsPhone, shortCallLink, SMS_MAX } = require('../src/notifications/templates');
const { createShortCodeLookup, setShortCodeLookup } = require('../src/notifications/callShortLink');
const { smsSegments, resetInstanceFlights } = require('../src/notifications/sendLedger');

const CALL_ID = '3f2b9c1e-7a4d-4e8b-9c21-5d6e7f8a9b0c';
const CODE = 'K7P2QXZ'; // 7 chars (migration default)
const CODE8 = 'K7P2QXZW'; // longest code the route accepts
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
    for (const code of [CODE8, null]) {
      it(`${name}${code ? ' + short link' : ' (no short code)'}`, () => {
        const sms = renderStaffSms({ ...spec, shortCode: code, deskBase: 'https://app.scalers.co.ke' });
        assert.ok(sms.length <= SMS_MAX, `${sms.length} > 160:\n${sms}`);
        assert.equal(isGsm7Basic(sms), true, sms);
        assert.equal(smsSegments(sms), 1);
        const lines = sms.split('\n');
        assert.match(lines[0], /^Mama Njeri Gas\S*\.\.\.: [a-z]/, 'business first, lowercase label');
        assert.equal(lines[1].endsWith(', 0712 345 678'), true, lines[1]);
        assert.match(lines[1], /^Wanjiku/);
        if (code) {
          assert.equal(lines.length, 4, sms);
          assert.equal(lines[3], `app.scalers.co.ke/c/${code}`, 'link always kept');
        } else {
          assert.equal(lines.length, 3, sms);
          assert.doesNotMatch(sms, /\/c\//);
        }
        assert.ok(lines[2].length >= 35, `reason too short:\n${sms}`);
        assert.match(lines[2], /\.\.\.$/, 'long reason ends with ...');
        assert.doesNotMatch(sms, /transfer|connected|confirmed|booked|https?:\/\//i);
      });
    }
  }
});

describe('renderStaffSms: format', () => {
  const link = { shortCode: 'K7P2QX', deskBase: 'https://app.scalers.co.ke/' };
  it('the agreed example, exactly', () => {
    const sms = renderStaffSms({
      kind: 'lead',
      lead: {
        businessName: 'Mama Njeri Gas',
        name: 'Wanjiku Kamau',
        reason: 'Wants 13kg gas refill to Kahawa West today, asked regulator price',
        callerNumber: PHONE,
      },
      ...link,
    });
    assert.equal(
      sms,
      'Mama Njeri Gas: missed call\nWanjiku Kamau, 0712 345 678\nWants 13kg gas refill to Kahawa West today, asked regulator price\napp.scalers.co.ke/c/K7P2QX'
    );
  });
  it('labels: lowercase, callbacks and visits to confirm, never a booking or transfer', () => {
    const lab = (kind, reason) => renderStaffSms({ kind, lead: { businessName: 'B', name: 'N', reason, callerNumber: PHONE } }).split('\n')[0];
    assert.equal(lab('lead', 'x'), 'B: missed call');
    assert.equal(lab('escalation', 'refund'), 'B: call back');
    assert.equal(lab('service_request', 'ENQUIRY: price'), 'B: enquiry');
    assert.equal(lab('service_request', 'HOLD / PICKUP: cylinder'), 'B: hold request');
    assert.equal(lab('service_request', 'ORDER: cylinder'), 'B: order request');
    assert.equal(lab('service_request', 'CALLBACK: refund'), 'B: callback request');
    assert.equal(lab('appointment', 'VISIT REQUEST: install'), 'B: visit request - to confirm');
    assert.equal(lab('appointment', 'VISIT UPDATED: install'), 'B: visit changed - to confirm');
    assert.equal(lab('appointment', 'VISIT CANCELLED: install'), 'B: visit cancelled');
    assert.equal(lab('voicemail', 'msg'), 'B: voicemail');
    assert.equal(lab('callback', 'x'), 'B: callback request');
  });
  it('the title prefix is not repeated in the reason line', () => {
    const sms = renderStaffSms({ kind: 'service_request', lead: { businessName: 'B', name: 'N', reason: 'ENQUIRY: 6kg refill. Today', callerNumber: PHONE } });
    assert.equal(sms, 'B: enquiry\nN, 0712 345 678\n6kg refill. Today');
  });
  it('missing reason or name: no empty lines', () => {
    const sms = renderStaffSms({ kind: 'lead', lead: { businessName: 'B', callerNumber: PHONE }, ...link });
    assert.equal(sms, 'B: missed call\nCaller, 0712 345 678\napp.scalers.co.ke/c/K7P2QX');
  });
  it('Kenyan numbers as 07xx / 01xx; others as given', () => {
    assert.equal(smsPhone('+254712345678'), '0712 345 678');
    assert.equal(smsPhone('254 712 345 678'), '0712 345 678');
    assert.equal(smsPhone('0712345678'), '0712 345 678');
    assert.equal(smsPhone('+254110345678'), '0110 345 678');
    assert.equal(smsPhone('+255712345678'), '+255712345678');
    assert.equal(smsPhone('+442071234567'), '+442071234567');
    assert.equal(smsPhone('+254201234567'), '+254201234567', 'landline left as is');
  });
  it('short link: only a valid code (no 0/O/1/I/L), else no link', () => {
    assert.equal(shortCallLink('K7P2QX', 'https://app.scalers.co.ke'), 'app.scalers.co.ke/c/K7P2QX');
    for (const bad of [null, '', 'K7P2Q', 'K7P2QXZWA', 'K0P2QX', 'KOP2QX', 'K1P2QX', 'KIP2QX', 'KLP2QX', 'k7p2qx', CALL_ID]) {
      assert.equal(shortCallLink(bad, 'https://app.scalers.co.ke'), null, String(bad));
    }
    const sms = renderStaffSms({ kind: 'lead', lead: { businessName: 'B', name: 'N', reason: 'r', callerNumber: PHONE }, shortCode: 'bad' });
    assert.equal(sms, 'B: missed call\nN, 0712 345 678\nr');
  });
  it('not a staff call alert: null (caller, billing, wallet keep their text)', () => {
    for (const kind of ['caller_callback', 'missed_textback', 'platform_billing_suspended', 'wallet_low', 'outage_speech']) {
      assert.equal(renderStaffSms({ kind, lead: { businessName: 'B', name: 'N', reason: 'r', callerNumber: PHONE } }), null, kind);
    }
  });
});

describe('short code lookup (calls.short_code)', () => {
  it('reads by call id, caches, and accepts only valid codes', async () => {
    const asked = [];
    const l = createShortCodeLookup({ select: async (by) => { asked.push(by); return { data: { short_code: CODE }, error: null }; }, log: () => {} });
    assert.equal(await l.lookup({ callId: CALL_ID }), CODE);
    assert.equal(await l.lookup({ callId: CALL_ID }), CODE);
    assert.deepEqual(asked, [{ column: 'id', value: CALL_ID }]);
    const bad = createShortCodeLookup({ select: async () => ({ data: { short_code: 'abc' } }), log: () => {} });
    assert.equal(await bad.lookup({ callId: CALL_ID }), null);
  });
  it('falls back to the call sid when there is no call id', async () => {
    const asked = [];
    const l = createShortCodeLookup({ select: async (by) => { asked.push(by); return { data: { short_code: CODE } }; }, log: () => {} });
    assert.equal(await l.lookup({ callSid: 'sk_123' }), CODE);
    assert.deepEqual(asked, [{ column: 'sautikit_call_sid', value: 'sk_123' }]);
    assert.equal(await l.lookup({}), null);
  });
  it('column missing (migration not applied): no link, backs off', async () => {
    let calls = 0;
    let t = 0;
    const logs = [];
    const l = createShortCodeLookup({
      select: async () => { calls += 1; return { data: null, error: { code: '42703', message: 'column calls.short_code does not exist' } }; },
      log: (m) => logs.push(m),
      now: () => t,
    });
    assert.equal(await l.lookup({ callId: CALL_ID }), null);
    assert.equal(await l.lookup({ callId: CALL_ID }), null);
    assert.equal(calls, 1);
    assert.equal(logs.length, 1);
    t = 11 * 60_000;
    await l.lookup({ callId: CALL_ID });
    assert.equal(calls, 2);
  });
  it('errors, throws and timeouts: no link, never throws', async () => {
    const thrown = createShortCodeLookup({ select: async () => { throw new Error('boom'); }, log: () => {} });
    assert.equal(await thrown.lookup({ callId: CALL_ID }), null);
    const slow = createShortCodeLookup({ select: () => new Promise(() => {}), log: () => {}, timeoutMs: 20 });
    assert.equal(await slow.lookup({ callId: CALL_ID }), null);
    assert.equal(await createShortCodeLookup({}).lookup({ callId: CALL_ID }), null);
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
    setShortCodeLookup(null);
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
    assert.match(msg, /^Mama Njeri Gas\S*\.\.\.: missed call\n/);
    assert.doesNotMatch(msg, /\/c\//, 'no call on the ledger: no link');
  });

  it('lead SMS carries the short link when the call has a code', async () => {
    const sent = setup();
    setShortCodeLookup({ lookup: async ({ callId }) => (callId === CALL_ID ? CODE : null) });
    const { dispatchAlert } = require('../src/notifications/dispatch');
    await dispatchAlert({
      to: PHONE,
      body: 'full text',
      lead: { businessName: LONG_BIZ, name: LONG_NAME, reason: LONG_REASON, callerNumber: PHONE },
      kind: 'lead',
      ledger: { callId: CALL_ID, kind: 'lead' },
      channels: { sms: true, whatsapp: false, email: false },
    });
    const msg = sent.find((s) => s.body && s.body.message).body.message;
    assert.ok(msg.length <= 160, msg);
    assert.ok(msg.endsWith(`\napp.scalers.co.ke/c/${CODE}`), msg);
  });

  it('a non-alert kind (wallet) keeps its full text on SMS', async () => {
    const sent = setup();
    const { dispatchAlert } = require('../src/notifications/dispatch');
    const body = 'Scalers wallet running low. B\nBalance KES 120.';
    await dispatchAlert({ to: PHONE, body, kind: 'wallet_low', channels: { sms: true, whatsapp: false, email: false } });
    assert.equal(sent.find((s) => s.body && s.body.message).body.message, body);
  });
});
