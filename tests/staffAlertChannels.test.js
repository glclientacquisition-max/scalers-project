// Run: node --test tests/staffAlertChannels.test.js
// Staff call alerts on WhatsApp and email (#777): same structure as the SMS
// (business: label / caller, 07xx number / what they want / short link), no
// 160 cap. WhatsApp: session text when the 24h window is open; the approved
// scalers_staff_alert template (text unchanged) gets the same fields in its
// three variables. Email: HTML card + plain text. Callbacks only.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { staffAlert, renderStaffWhatsApp, staffAlertTemplateLines, telHref } = require('../src/notifications/templates');
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

describe('WhatsApp staff alert body', () => {
  it('lead (snapshot)', () => {
    assert.equal(
      renderStaffWhatsApp(alertOf(SAMPLES.lead)),
      [
        '*Mama Njeri Gas: missed call*',
        'Wanjiku Kamau, 0712 345 678',
        'Wants 13kg gas refill to Kahawa West today, asked regulator price',
        `Recording: ${REC}`,
        LINK,
      ].join('\n')
    );
  });
  it('visit request (snapshot): full where and notes, no cap', () => {
    assert.equal(
      renderStaffWhatsApp(alertOf(SAMPLES.visitRequest)),
      [
        '*Mama Njeri Gas: visit request - to confirm*',
        'Wanjiku Kamau, 0712 345 678',
        'Gas cooker installation',
        'When: Thursday 10am',
        'Where: Kahawa West, near Quickmart',
        'Notes: Bring a 2m hose',
        LINK,
      ].join('\n')
    );
  });
  it('order (snapshot)', () => {
    assert.equal(
      renderStaffWhatsApp(alertOf(SAMPLES.order)),
      ['*Mama Njeri Gas: order request*', 'Wanjiku Kamau, 0712 345 678', '13kg refill', 'Qty: 2', 'When: Tomorrow morning', 'Notes: Pay on delivery', LINK].join('\n')
    );
  });
  it('escalation (snapshot): who it is for, never a transfer', () => {
    assert.equal(
      renderStaffWhatsApp(alertOf(SAMPLES.escalation)),
      ['*Mama Njeri Gas: call back*', 'Wanjiku Kamau, 0712 345 678', 'Refund for a leaking 6kg cylinder bought Saturday', 'For: Peter (Manager)', `Recording: ${REC}`, LINK].join('\n')
    );
  });
  for (const [name, spec] of Object.entries(SAMPLES)) {
    it(`${name}: structure, bold first line only, banned words`, () => {
      const body = renderStaffWhatsApp(alertOf(spec));
      const lines = body.split('\n');
      assert.equal(lines[0], `*Mama Njeri Gas: ${LABELS[name]}*`);
      assert.equal(lines[1], 'Wanjiku Kamau, 0712 345 678');
      assert.equal(lines.at(-1), LINK);
      assert.equal((body.match(/\*/g) || []).length, 2, 'bold first line only');
      assert.doesNotMatch(body, /\p{Extended_Pictographic}/u, 'no emoji');
      assert.doesNotMatch(body, BANNED);
    });
  }
  it('no short code: falls back to the full call URL', () => {
    const body = renderStaffWhatsApp(alertOf(SAMPLES.visitRequest, null));
    assert.equal(body.split('\n').at(-1), FULL);
  });
  it('caller text cannot break the bold line', () => {
    const body = renderStaffWhatsApp(alertOf({ ...SAMPLES.lead, lead: { ...SAMPLES.lead.lead, businessName: '*Mama* _Njeri_', name: 'Wa*njiku' } }));
    assert.equal(body.split('\n')[0], '*Mama Njeri: missed call*');
    assert.equal(body.split('\n')[1], 'Wanjiku, 0712 345 678');
  });
  it('approved template variables: same fields, no URLs, never empty', () => {
    assert.deepEqual(staffAlertTemplateLines(alertOf(SAMPLES.visitRequest)), [
      'Mama Njeri Gas: visit request - to confirm',
      'Wanjiku Kamau, 0712 345 678',
      'Gas cooker installation. When: Thursday 10am. Where: Kahawa West, near Quickmart. Notes: Bring a 2m hose',
    ]);
    for (const spec of Object.values(SAMPLES)) {
      const lines = staffAlertTemplateLines(alertOf(spec));
      assert.equal(lines.length, 3);
      for (const v of lines) {
        assert.ok(v.trim());
        assert.doesNotMatch(v, /https?:\/\//);
      }
    }
  });
  it('the session text payload uses the new body; template text untouched', () => {
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = process.env.SAUTIKIT_WHATSAPP_NUMBER_ID || 'num-test';
    const { buildWhatsAppSendPayload } = require('../src/notifications/whatsapp');
    const alert = alertOf(SAMPLES.lead);
    const open = buildWhatsAppSendPayload({ to: '+254711000000', body: SAMPLES.lead.body, lead: SAMPLES.lead.lead, kind: 'lead', windowOpen: true, sessionBody: renderStaffWhatsApp(alert), alertLines: staffAlertTemplateLines(alert) });
    assert.equal(open.type, 'text');
    assert.equal(open.text.body, renderStaffWhatsApp(alert));
    const cold = buildWhatsAppSendPayload({ to: '+254711000000', body: SAMPLES.lead.body, lead: SAMPLES.lead.lead, kind: 'lead', windowOpen: false, sessionBody: renderStaffWhatsApp(alert), alertLines: staffAlertTemplateLines(alert) });
    assert.equal(cold.type, 'template');
    assert.equal(cold.template.name, 'scalers_staff_alert');
    assert.deepEqual(cold.template.components[0].parameters.map((p) => p.text), staffAlertTemplateLines(alert));
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
