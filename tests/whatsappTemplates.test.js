// Run: node --test tests/whatsappTemplates.test.js
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStaffWhatsAppTemplate,
  parametersForKind,
  sanitizeParam,
  templateNameForKind,
} = require('../src/notifications/whatsappTemplates');
const {
  buildLeadText,
  buildWhatsAppSendPayload,
  sendOwnerWhatsApp,
} = require('../src/notifications/whatsapp');
const { dispatchAlert } = require('../src/notifications/dispatch');

const ENV_KEYS = [
  'SAUTIKIT_API_KEY',
  'SAUTIKIT_API_BASE',
  'SAUTIKIT_WHATSAPP_NUMBER_ID',
  'SAUTIKIT_WHATSAPP_CONNECTION_ID',
  'SAUTIKIT_WHATSAPP_TEMPLATE',
  'SAUTIKIT_WHATSAPP_TEMPLATE_LANG',
  'SAUTIKIT_WHATSAPP_TEMPLATE_LEAD',
  'SAUTIKIT_WHATSAPP_TEMPLATE_ESCALATION',
  'SAUTIKIT_WHATSAPP_TEMPLATE_APPOINTMENT',
  'SAUTIKIT_WHATSAPP_TEMPLATE_SERVICE_REQUEST',
  'SAUTIKIT_WHATSAPP_TEMPLATE_WALLET',
  'SAUTIKIT_WHATSAPP_TEMPLATE_OUTAGE',
  'TEXTSMS_API_KEY',
  'TEXTSMS_PARTNER_ID',
  'TEXTSMS_SHORTCODE',
  'RESEND_API_KEY',
  'ALERT_EMAIL_FROM',
];

describe('staff WhatsApp templates', () => {
  /** @type {Record<string, string|undefined>} */
  let saved = {};

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    mock.restoreAll();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('defaults kind names to scalers_* catalog', () => {
    assert.equal(templateNameForKind('lead'), 'scalers_lead');
    assert.equal(templateNameForKind('escalation'), 'scalers_escalation');
    assert.equal(templateNameForKind('appointment'), 'scalers_visit');
    assert.equal(templateNameForKind('service_request'), 'scalers_request');
    assert.equal(templateNameForKind('wallet_low'), 'scalers_wallet');
    assert.equal(templateNameForKind('wallet_empty'), 'scalers_wallet');
    assert.equal(templateNameForKind('outage_speech'), 'scalers_outage');
    assert.equal(templateNameForKind('outage_llm'), 'scalers_outage');
    assert.equal(templateNameForKind('unknown'), 'scalers_staff_alert');
  });

  it('kind env wins, then generic env', () => {
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE = 'scalers_staff_alert';
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_LEAD = 'scalers_lead';
    assert.equal(templateNameForKind('lead'), 'scalers_lead');
    assert.equal(templateNameForKind('appointment'), 'scalers_staff_alert');
  });

  it('lead params match the approval body', () => {
    const params = parametersForKind('lead', {
      body: 'New missed-call lead. Done and Dusted Cleaning Services\nName: Jane\nPhone: 254790381872\nReason: Book carpet cleaning\nOpen call: https://desk.example/calls/1',
      lead: {
        businessName: 'Done and Dusted Cleaning Services',
        name: 'Jane',
        callerNumber: '254790381872',
        reason: 'Book carpet cleaning',
      },
    });
    assert.deepEqual(params, [
      'Done and Dusted Cleaning Services',
      'Name: Jane. Phone: 254790381872',
      'Reason: Book carpet cleaning',
    ]);
    for (const p of params) assert.doesNotMatch(p, /[—–]|https?:\/\//);
  });

  it('escalation params are teammate, business, caller block', () => {
    const params = parametersForKind('escalation', {
      body: 'Escalation for Wanjiku. Done and Dusted Cleaning Services\nCaller: Jane\nPhone: 254790381872\nReason: Ask for Wanjiku',
      lead: {
        businessName: 'Done and Dusted Cleaning Services',
        name: 'Jane',
        callerNumber: '254790381872',
        reason: 'Ask for Wanjiku',
      },
    });
    assert.deepEqual(params, [
      'Wanjiku',
      'Done and Dusted Cleaning Services',
      'Caller: Jane. Phone: 254790381872. Reason: Ask for Wanjiku',
    ]);
  });

  it('visit and request keep titled layout without stuffing a lead', () => {
    const visit = parametersForKind('appointment', {
      body: 'VISIT REQUEST. Done and Dusted Cleaning Services\nService: Carpet cleaning\nWhen: Fri 10:00\nCaller: Jane\nPhone: 254790381872\nOpen Inbox Visits to confirm or cancel.',
      lead: { businessName: 'Done and Dusted Cleaning Services', reason: 'Visit' },
    });
    assert.equal(visit[0], 'VISIT REQUEST');
    assert.equal(visit[1], 'Done and Dusted Cleaning Services');
    assert.match(visit[2], /Carpet cleaning/);
    assert.doesNotMatch(visit[2], /https?:\/\//);

    const hold = parametersForKind('service_request', {
      body: 'HOLD / PICKUP. Westlands Books\nItem: Atomic Habits\nWhen: Today 4pm\nCaller: Jane\nPhone: 254711000000',
      lead: { businessName: 'Westlands Books' },
    });
    assert.equal(hold[0], 'HOLD / PICKUP');
    assert.equal(hold[1], 'Westlands Books');
    assert.match(hold[2], /Atomic Habits/);
  });

  it('wallet and outage do not use missed-call fields', () => {
    const wallet = parametersForKind('wallet_low', {
      body: 'Scalers wallet running low. Westlands Books\nPrepaid balance is about KES 1,200 (alert under KES 200).\nTop up soon so calls keep being covered.',
      lead: { businessName: 'Westlands Books', reason: 'Prepaid wallet low' },
    });
    assert.equal(wallet[0], 'Scalers wallet running low');
    assert.equal(wallet[1], 'Westlands Books');
    assert.match(wallet[2], /KES 1,200/);

    const outage = parametersForKind('outage_speech', {
      body: 'Westlands Books line downtime. Callers heard a short message and were asked to call back.',
      lead: { reason: 'Speech downtime' },
    });
    assert.match(outage[0], /line downtime/);
    assert.match(outage[1], /call back/);
    assert.equal(outage[2], 'Open the desk to act.');
  });

  it('legacy non-scalers template keeps name phone reason', () => {
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE = 'missed_call_lead';
    const params = parametersForKind('lead', {
      lead: { name: 'Jane', callerNumber: '254790381872', reason: 'Book carpet cleaning' },
    });
    assert.deepEqual(params, ['Jane', '254790381872', 'Book carpet cleaning']);
    assert.equal(templateNameForKind('appointment'), 'missed_call_lead');
  });

  it('sanitizeParam never returns empty and strips urls and dashes', () => {
    assert.equal(sanitizeParam(''), '.');
    assert.equal(sanitizeParam('See https://desk.example/calls/1 now'), 'See now');
    assert.doesNotMatch(sanitizeParam('Hello — world'), /[—–]/);
  });

  it('buildStaffWhatsAppTemplate always has 3 params', () => {
    const tpl = buildStaffWhatsAppTemplate({
      kind: 'lead',
      lead: { businessName: 'Shop', name: 'Ann', callerNumber: '2547', reason: 'Hi' },
    });
    assert.equal(tpl.name, 'scalers_lead');
    assert.equal(tpl.language_code, 'en');
    assert.equal(tpl.parameters.length, 3);
  });

  it('closed window is type template never session text', () => {
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = 'num-1';
    const payload = buildWhatsAppSendPayload({
      to: '0740442943',
      kind: 'lead',
      windowOpen: false,
      lead: {
        businessName: 'Shop',
        name: 'Jane',
        callerNumber: '254740442943',
        reason: 'Book',
      },
    });
    assert.equal(payload.to, '254740442943');
    assert.equal(payload.type, 'template');
    assert.equal(payload.template.name, 'scalers_lead');
    assert.equal(payload.template.components[0].parameters.length, 3);
    assert.equal(buildLeadText({ businessName: 'Shop', name: 'Jane' }).includes('—'), false);
  });

  it('dispatchAlert WhatsApp uses the kind template when SMS is down', async () => {
    process.env.SAUTIKIT_API_KEY = 'k';
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = 'num-1';
    const calls = [];
    mock.method(global, 'fetch', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, status: 202, text: async () => JSON.stringify({ id: 'w1' }) };
    });
    const result = await dispatchAlert({
      to: '+254711000000',
      body: 'VISIT REQUEST. Shop\nService: Haircut\nCaller: Jane',
      lead: { businessName: 'Shop', name: 'Jane', reason: 'Visit' },
      channels: { sms: true, whatsapp: true, email: false },
      ledger: { tenantId: 't1', callSid: 'CA1', kind: 'appointment' },
    });
    assert.equal(result.channel, 'whatsapp');
    assert.equal(calls[0].body.type, 'template');
    assert.equal(calls[0].body.template.name, 'scalers_visit');
    assert.equal(calls[0].body.template.components[0].parameters[0].text, 'VISIT REQUEST');
  });

  it('sendOwnerWhatsApp posts the template payload', async () => {
    process.env.SAUTIKIT_API_KEY = 'k';
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = 'num-1';
    let posted = null;
    mock.method(global, 'fetch', async (_url, init) => {
      posted = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => '{}' };
    });
    await sendOwnerWhatsApp({
      to: '254711000000',
      kind: 'escalation',
      windowOpen: false,
      body: 'Escalation for Wanjiku. Shop\nCaller: Jane',
      lead: { businessName: 'Shop', name: 'Jane', callerNumber: '254711', reason: 'Ask' },
    });
    assert.equal(posted.type, 'template');
    assert.equal(posted.template.name, 'scalers_escalation');
  });
});
