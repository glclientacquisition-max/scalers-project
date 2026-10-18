// Run: node --test tests/staffAlertChannels.test.js
// Staff call alerts on WhatsApp and email (#777).
// WhatsApp: the SMS body (same 4 lines, caps, truncation, short link), first
// line bold, at most 160 characters. Session text when the 24h window is
// open; the approved scalers_staff_alert template (text unchanged) gets SMS
// lines 1-3 in its three variables. Email: HTML card + plain text (full
// reason and details). Callbacks only.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { staffAlert, renderStaffSms, renderStaffWhatsApp, staffSmsTemplateLines, telHref, SMS_MAX } = require('../src/notifications/templates');
const { smsSegments } = require('../src/notifications/sendLedger');
const { renderStaffAlertEmail, ALERT_EMAIL_BRAND } = require('../src/notifications/alertEmail');
const { setShortCodeLookup } = require('../src/notifications/callShortLink');
const { resetInstanceFlights } = require('../src/notifications/sendLedger');
const { SAMPLES, CALL_ID, REC } = require('./fixtures/staffAlertSamples');

const CODE = 'K7P2QXZ';
const LINK = `https://app.scalers.co.ke/c/${CODE}`;
const FULL = `https://app.scalers.co.ke/calls/${CALL_ID}`;
const BANNED = /transfer|connected|confirmed|booked/i;
const alertOf = (spec, shortCode = CODE) =>
  staffAlert({ ...spec, shortCode, deskBase: 'https://app.scalers.co.ke', callId: CALL_ID });

const LABELS = {
  lead: 'missed call',
  escalation: 'call back',
  enquiry: 'enquiry',
  hold: 'hold request',
  order: 'order request',
  callbackRequest: 'callback request',
  visitRequest: 'visit request - to confirm',
  visitChanged: 'visit changed - to confirm',
  visitCancelled: 'visit cancelled',
  voicemail: 'voicemail',
  callback: 'callback request',
};

const waOf = (spec, shortCode = CODE) => renderStaffWhatsApp({ ...spec, shortCode, deskBase: 'https://app.scalers.co.ke' });
const SHORT = `app.scalers.co.ke/c/${CODE}`;
const LONG_LEAD = {
  businessName: 'Mama Njeri Gas & Hardware Supplies and General Merchants Ltd',
  name: 'Wanjiku \u201cShiru\u201d Kamau-Njoroge Wa Mwangi \ud83d\ude00',
  callerNumber: '+254712345678',
  reason: 'Wants a 13kg gas refill delivered to Kahawa West today \u2013 asked about the price of a new regulator, a hose, and whether you deliver on Sunday \ud83d\ude4f',
};

describe('WhatsApp staff alert body: the SMS body, first line bold', () => {
  it('lead (snapshot)', () => {
    assert.equal(
      waOf(SAMPLES.lead),
      ['*Mama Njeri Gas: missed call*', 'Wanjiku Kamau, 0712 345 678', 'Wants 13kg gas refill to Kahawa West today, asked regulator price', SHORT].join('\n')
    );
  });
  it('visit request (snapshot): no where / notes rows', () => {
    assert.equal(
      waOf(SAMPLES.visitRequest),
      ['*Mama Njeri Gas: visit request - to confirm*', 'Wanjiku Kamau, 0712 345 678', 'Gas cooker installation. Thursday 10am', SHORT].join('\n')
    );
  });
  for (const [name, spec] of Object.entries(SAMPLES)) {
    it(`${name}: same 4 lines as the SMS, <= 160, bold first line only`, () => {
      const wa = waOf(spec);
      const sms = renderStaffSms({ ...spec, shortCode: CODE, deskBase: 'https://app.scalers.co.ke' });
      const lines = wa.split('\n');
      assert.equal(lines.length, 4, wa);
      assert.equal(lines[0], `*Mama Njeri Gas: ${LABELS[name]}*`);
      assert.deepEqual(lines.slice(1), sms.split('\n').slice(1), 'lines 2-4 match the SMS');
      assert.equal(lines[3], SHORT);
      assert.ok(wa.length <= SMS_MAX, `${wa.length}`);
      assert.equal((wa.match(/\*/g) || []).length, 2);
      assert.doesNotMatch(wa, /Where:|Notes:|Recording:|https?:\/\//);
      assert.doesNotMatch(wa, /\p{Extended_Pictographic}/u);
      assert.doesNotMatch(wa, BANNED);
    });
  }
  it('worst case: <= 160 with the bold and an 8-char link, GSM-7, one segment', () => {
    for (const kind of ['lead', 'escalation', 'service_request', 'appointment', 'voicemail', 'callback']) {
      for (const reason of [LONG_LEAD.reason, `VISIT UPDATED: ${LONG_LEAD.reason}`, `HOLD / PICKUP: ${LONG_LEAD.reason}`]) {
        const wa = renderStaffWhatsApp({ kind, lead: { ...LONG_LEAD, reason }, shortCode: 'K7P2QXZW', deskBase: 'https://app.scalers.co.ke' });
        assert.ok(wa.length <= SMS_MAX, `${wa.length}:\n${wa}`);
        assert.equal(smsSegments(wa), 1);
        assert.equal(wa.split('\n')[3], 'app.scalers.co.ke/c/K7P2QXZW');
        assert.match(wa.split('\n')[2], /\.\.\.$/);
      }
    }
  });
  it('no short code: no link line (as the SMS)', () => {
    const wa = waOf(SAMPLES.visitRequest, null);
    assert.equal(wa.split('\n').length, 3);
    assert.doesNotMatch(wa, /\/c\//);
  });
  it('caller text cannot break the bold line', () => {
    const wa = waOf({ ...SAMPLES.lead, lead: { ...SAMPLES.lead.lead, businessName: '*Mama* _Njeri_', name: 'Wa*njiku' } });
    assert.equal(wa.split('\n')[0], '*Mama Njeri: missed call*');
    assert.equal(wa.split('\n')[1], 'Wanjiku, 0712 345 678');
  });
  it('approved template variables: SMS lines 1-3, no URLs, never empty', () => {
    assert.deepEqual(staffSmsTemplateLines(SAMPLES.visitRequest), [
      'Mama Njeri Gas: visit request - to confirm',
      'Wanjiku Kamau, 0712 345 678',
      'Gas cooker installation. Thursday 10am',
    ]);
    assert.equal(staffSmsTemplateLines({ kind: 'lead', lead: { businessName: 'B', callerNumber: '+254712345678' } })[2], 'No reason given');
    for (const spec of Object.values(SAMPLES)) {
      const lines = staffSmsTemplateLines(spec);
      assert.equal(lines.length, 3);
      for (const v of lines) {
        assert.ok(v.trim());
        assert.doesNotMatch(v, /https?:\/\/|\/c\//);
      }
    }
  });
  it('session text payload uses the short body; cold send keeps scalers_staff_alert text', () => {
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = process.env.SAUTIKIT_WHATSAPP_NUMBER_ID || 'num-test';
    const { buildWhatsAppSendPayload } = require('../src/notifications/whatsapp');
    const sessionBody = waOf(SAMPLES.lead);
    const alertLines = staffSmsTemplateLines(SAMPLES.lead);
    const base = { to: '+254711000000', body: SAMPLES.lead.body, lead: SAMPLES.lead.lead, kind: 'lead', sessionBody, alertLines };
    const open = buildWhatsAppSendPayload({ ...base, windowOpen: true });
    assert.equal(open.type, 'text');
    assert.equal(open.text.body, sessionBody);
    const cold = buildWhatsAppSendPayload({ ...base, windowOpen: false });
    assert.equal(cold.type, 'template');
    assert.equal(cold.template.name, 'scalers_staff_alert');
    assert.deepEqual(cold.template.components[0].parameters.map((p) => p.text), alertLines);
  });
});

describe('alert email', () => {
  it('subject, preheader, button, plain text for a lead', () => {
    const mail = renderStaffAlertEmail(alertOf(SAMPLES.lead));
    assert.equal(mail.subject, 'Mama Njeri Gas: missed call from Wanjiku Kamau');
    assert.equal(mail.preheader, 'Wants 13kg gas refill to Kahawa West today, asked regulator price');
    assert.match(mail.html, /<div style="display:none;[^"]*">Wants 13kg gas refill to Kahawa West today, asked regulator price<\/div>/);
    assert.match(mail.html, new RegExp(`<a href="${LINK}"[^>]*>Open call</a>`));
    assert.equal((mail.html.match(/>Open call<\/a>/g) || []).length, 1, 'one primary button');
    assert.match(mail.html, /<a href="tel:\+254712345678"[^>]*>0712 345 678<\/a>/);
    assert.match(mail.html, new RegExp(`<a href="${REC}"[^>]*>Play recording</a>`));
    assert.equal(
      mail.text,
      [
        'Missed call - Mama Njeri Gas',
        '',
        'Wanjiku Kamau',
        '0712 345 678',
        '',
        'Wants 13kg gas refill to Kahawa West today, asked regulator price',
        '',
        `Recording: ${REC}`,
        '',
        `Open call: ${LINK}`,
        '',
        '--',
        ALERT_EMAIL_BRAND,
      ].join('\n')
    );
  });
  it('subject falls back to the number when the name is unknown', () => {
    const mail = renderStaffAlertEmail(alertOf({ ...SAMPLES.lead, lead: { ...SAMPLES.lead.lead, name: 'Caller' } }));
    assert.equal(mail.subject, 'Mama Njeri Gas: missed call from 0712 345 678');
  });
  it('button falls back to the full call URL without a short code', () => {
    const mail = renderStaffAlertEmail(alertOf(SAMPLES.visitRequest, null));
    assert.match(mail.html, new RegExp(`<a href="${FULL}"[^>]*>Open call</a>`));
    assert.match(mail.text, new RegExp(`Open call: ${FULL}`));
  });
  it('visit details: when, where, notes rows', () => {
    const mail = renderStaffAlertEmail(alertOf(SAMPLES.visitRequest));
    for (const [label, value] of [['When', 'Thursday 10am'], ['Where', 'Kahawa West, near Quickmart'], ['Notes', 'Bring a 2m hose']]) {
      assert.match(mail.html, new RegExp(`>${label}</td>\\s*<td[^>]*>${value}</td>`));
      assert.match(mail.text, new RegExp(`^${label}: ${value}$`, 'm'));
    }
  });
  for (const [name, spec] of Object.entries(SAMPLES)) {
    it(`${name}: table layout, inline CSS, dark-mode safe, no images or web fonts, no banned words`, () => {
      const mail = renderStaffAlertEmail(alertOf(spec));
      assert.equal(mail.subject, `Mama Njeri Gas: ${LABELS[name]} from Wanjiku Kamau`);
      assert.match(mail.html, /<table role="presentation"/);
      assert.match(mail.html, /<meta name="color-scheme" content="light dark">/);
      assert.match(mail.html, /@media \(prefers-color-scheme: dark\)/);
      assert.doesNotMatch(mail.html, /<img|<link|@import|@font-face|fonts\.googleapis|<script/i);
      assert.doesNotMatch(mail.html, /\p{Extended_Pictographic}/u);
      assert.match(mail.html, new RegExp(`>${ALERT_EMAIL_BRAND}</td>`));
      for (const part of [mail.subject, mail.preheader, mail.text, mail.html]) assert.doesNotMatch(part, BANNED, name);
      assert.ok(mail.text.includes(`Open call: ${LINK}`));
    });
  }
  it('caller text is escaped', () => {
    const mail = renderStaffAlertEmail(alertOf({ ...SAMPLES.lead, lead: { ...SAMPLES.lead.lead, reason: '<script>x</script> & "q"' } }));
    assert.doesNotMatch(mail.html, /<script>/);
    assert.match(mail.html, /&lt;script&gt;x&lt;\/script&gt; &amp; &quot;q&quot;/);
  });
  it('tel links: Kenyan to +254, others as digits', () => {
    assert.equal(telHref('0712 345 678'), 'tel:+254712345678');
    assert.equal(telHref('+44 20 7123 4567'), 'tel:+442071234567');
    assert.equal(telHref(''), null);
  });
  it('not a staff call alert: no model (billing, wallet, ops keep their text)', () => {
    for (const kind of ['wallet_low', 'platform_billing_suspended', 'outage_speech', 'missed_textback']) {
      assert.equal(staffAlert({ kind, lead: { businessName: 'B' }, body: 'x' }), null, kind);
    }
  });
});

describe('dispatchAlert email: HTML for call alerts, text unchanged for others', () => {
  const ENV = { RESEND_API_KEY: 'k', ALERT_EMAIL_FROM: 'alerts@example.test' };
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
    for (const [k, v] of Object.entries({ ...ENV, TEXTSMS_API_KEY: undefined, SAUTIKIT_API_KEY: undefined })) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const sent = [];
    realFetch = global.fetch;
    global.fetch = async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return sent;
  }
  it('visit request email: new subject, HTML card, plain text, short link', async () => {
    const sent = setup();
    setShortCodeLookup({ lookup: async () => CODE });
    const { dispatchAlert } = require('../src/notifications/dispatch');
    const out = await dispatchAlert({
      email: 'owner@example.test',
      body: SAMPLES.visitRequest.body,
      lead: SAMPLES.visitRequest.lead,
      subject: 'VISIT REQUEST. Mama Njeri Gas',
      kind: 'appointment',
      ledger: { callId: CALL_ID, kind: 'appointment' },
      channels: { sms: false, whatsapp: false, email: true },
    });
    assert.equal(out.channel, 'email');
    const mail = sent.find((s) => s.url.includes('resend')).body;
    assert.equal(mail.subject, 'Mama Njeri Gas: visit request - to confirm from Wanjiku Kamau');
    assert.match(mail.html, new RegExp(`<a href="${LINK}"[^>]*>Open call</a>`));
    assert.match(mail.text, /^Visit request - to confirm - Mama Njeri Gas/);
  });
  it('wallet email keeps its subject and text, no HTML', async () => {
    const sent = setup();
    const { dispatchAlert } = require('../src/notifications/dispatch');
    const body = 'Scalers wallet running low. B\nPrepaid balance is about KES 120.';
    await dispatchAlert({ email: 'owner@example.test', body, subject: 'Scalers wallet running low. B', kind: 'wallet_low', channels: { sms: false, whatsapp: false, email: true } });
    const mail = sent.find((s) => s.url.includes('resend')).body;
    assert.equal(mail.subject, 'Scalers wallet running low. B');
    assert.equal(mail.text, body);
    assert.equal(mail.html, undefined);
  });
});
