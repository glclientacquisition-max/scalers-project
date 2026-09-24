// Run: node --test tests/whatsappTemplates.test.js
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
  APPROVED_FIRST_TEMPLATE,
  APPROVED_FIRST_TEMPLATE_LANG,
  buildStaffWhatsAppTemplate,
  genericTemplateName,
  parametersForKind,
  sanitizeParam,
  templateNameForKind,
} = require('../src/notifications/whatsappTemplates');
const {
  buildLeadText,
  buildWhatsAppSendPayload,
  buildWhatsAppTemplatePayload,
  mapWhatsAppSendError,
  sendOwnerWhatsApp,
  sendWhatsAppTemplate,
} = require('../src/notifications/whatsapp');
const { dispatchAlert } = require('../src/notifications/dispatch');
const { walletEmptyBody, walletLowBody } = require('../src/notifications/templates');

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
  'SAUTIKIT_WHATSAPP_TEMPLATE_ALLOW_LEGACY',
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

  it('defaults every kind to the approved first template', () => {
    assert.equal(genericTemplateName(), APPROVED_FIRST_TEMPLATE);
    assert.equal(templateNameForKind('lead'), 'scalers_staff_alert');
    assert.equal(templateNameForKind('escalation'), 'scalers_staff_alert');
    assert.equal(templateNameForKind('appointment'), 'scalers_staff_alert');
    assert.equal(templateNameForKind('service_request'), 'scalers_staff_alert');
    assert.equal(templateNameForKind('wallet_low'), 'scalers_staff_alert');
    assert.equal(templateNameForKind('wallet_empty'), 'scalers_staff_alert');
    assert.equal(templateNameForKind('outage_speech'), 'scalers_staff_alert');
    assert.equal(templateNameForKind('outage_llm'), 'scalers_staff_alert');
    assert.equal(templateNameForKind('unknown'), 'scalers_staff_alert');
  });

  it('kind env wins, then generic env', () => {
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE = 'scalers_staff_alert';
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_LEAD = 'scalers_lead';
    assert.equal(templateNameForKind('lead'), 'scalers_lead');
    assert.equal(templateNameForKind('appointment'), 'scalers_staff_alert');
  });

  it('ignores stale missed_call_lead generic unless legacy is allowed', () => {
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE = 'missed_call_lead';
    assert.equal(templateNameForKind('lead'), 'scalers_staff_alert');
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_ALLOW_LEGACY = 'on';
    assert.equal(templateNameForKind('appointment'), 'missed_call_lead');
  });

  it('lead params match the approval body when the kind template is set', () => {
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_LEAD = 'scalers_lead';
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

  it('approved first template packs the generic 3-line body', () => {
    const params = parametersForKind('lead', {
      body: 'New missed-call lead. Done and Dusted Cleaning Services\nName: Jane\nPhone: 254790381872\nReason: Book carpet cleaning',
      lead: {
        businessName: 'Done and Dusted Cleaning Services',
        name: 'Jane',
        callerNumber: '254790381872',
        reason: 'Book carpet cleaning',
      },
    });
    assert.equal(params[0], 'New missed-call lead. Done and Dusted Cleaning Services');
    assert.equal(params.length, 3);
    for (const p of params) assert.doesNotMatch(p, /[—–]|https?:\/\//);
  });

  it('escalation params are teammate, business, caller block', () => {
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_ESCALATION = 'scalers_escalation';
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
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_APPOINTMENT = 'scalers_visit';
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_SERVICE_REQUEST = 'scalers_request';
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
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_WALLET = 'scalers_wallet';
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_OUTAGE = 'scalers_outage';
    const wallet = parametersForKind('wallet_low', {
      body: walletLowBody({
        businessName: 'Westlands Books',
        balanceKes: 1200,
        lowThresholdKes: 200,
      }),
      lead: { businessName: 'Westlands Books', reason: 'Prepaid wallet low' },
    });
    assert.deepEqual(wallet, [
      'Scalers wallet running low',
      'Westlands Books',
      'Prepaid balance is about KES 1,200 (alert under KES 200). Top up soon so calls stay covered.',
    ]);
    assert.doesNotMatch(wallet[2], /Enable it on Wallet if you want to continue/);

    const emptyOff = parametersForKind('wallet_empty', {
      body: walletEmptyBody({ businessName: 'Westlands Books', onDemandEnabled: false }),
      lead: { businessName: 'Westlands Books', reason: 'Prepaid wallet empty' },
    });
    assert.deepEqual(emptyOff, [
      'Scalers prepaid empty',
      'Westlands Books',
      'Prepaid balance is KES 0. On-demand is off. Top up or enable on-demand on Wallet.',
    ]);

    const emptyOn = parametersForKind('wallet_empty', {
      body: walletEmptyBody({ businessName: 'Westlands Books', onDemandEnabled: true }),
      lead: { businessName: 'Westlands Books', reason: 'Prepaid wallet empty' },
    });
    assert.deepEqual(emptyOn, [
      'Scalers prepaid empty',
      'Westlands Books',
      'Prepaid balance is KES 0. On-demand is on. Top up when you can.',
    ]);

    const outage = parametersForKind('outage_speech', {
      body: 'Westlands Books line downtime. Callers heard a short message and were asked to call back.',
      lead: { reason: 'Speech downtime' },
    });
    assert.match(outage[0], /line downtime/);
    assert.match(outage[1], /call back/);
    assert.equal(outage[2], 'Open the desk to act.');
  });

  it('legacy non-scalers template keeps name phone reason when allowed', () => {
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE = 'missed_call_lead';
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_ALLOW_LEGACY = 'on';
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
    assert.equal(tpl.name, APPROVED_FIRST_TEMPLATE);
    assert.equal(tpl.language_code, APPROVED_FIRST_TEMPLATE_LANG);
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
    assert.equal(payload.template.name, APPROVED_FIRST_TEMPLATE);
    assert.equal(payload.template.language_code, APPROVED_FIRST_TEMPLATE_LANG);
    assert.equal(payload.template.components[0].parameters.length, 3);
    assert.equal(buildLeadText({ businessName: 'Shop', name: 'Jane' }).includes('—'), false);
  });

  it('open 24h window stays session text even with a template name', () => {
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = 'num-1';
    const payload = buildWhatsAppSendPayload({
      to: '254790381872',
      body: 'Got it. A Scalers teammate will follow up.',
      windowOpen: true,
      kind: 'lead',
    });
    assert.equal(payload.type, 'text');
    assert.equal(payload.template, undefined);
    assert.equal(payload.text.body, 'Got it. A Scalers teammate will follow up.');
  });

  it('dispatchAlert WhatsApp uses the approved first template when SMS is down', async () => {
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
      kind: 'appointment',
    });
    assert.equal(result.channel, 'whatsapp');
    assert.equal(calls[0].body.type, 'template');
    assert.equal(calls[0].body.template.name, APPROVED_FIRST_TEMPLATE);
    assert.equal(calls[0].body.template.components[0].parameters[0].text, 'VISIT REQUEST. Shop');
  });

  it('kind env still selects a later approved template', async () => {
    process.env.SAUTIKIT_API_KEY = 'k';
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = 'num-1';
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_APPOINTMENT = 'scalers_visit';
    const calls = [];
    mock.method(global, 'fetch', async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, status: 202, text: async () => '{}' };
    });
    await dispatchAlert({
      to: '+254711000000',
      body: 'VISIT REQUEST. Shop\nService: Haircut\nCaller: Jane',
      lead: { businessName: 'Shop', name: 'Jane', reason: 'Visit' },
      channels: { sms: false, whatsapp: true, email: false },
      kind: 'appointment',
    });
    assert.equal(calls[0].template.name, 'scalers_visit');
  });

  it('sendOwnerWhatsApp posts the approved first template', async () => {
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
    assert.equal(posted.template.name, APPROVED_FIRST_TEMPLATE);
  });

  it('sendWhatsAppTemplate is parameterized and dry-run never POSTs', async () => {
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = 'num-1';
    let posted = false;
    mock.method(global, 'fetch', async () => {
      posted = true;
      return { ok: true, status: 200, text: async () => '{}' };
    });
    const dry = await sendWhatsAppTemplate({
      to: '+254711000000',
      templateName: 'hello_world',
      language: 'en_US',
      parameters: ['A', 'B', 'C'],
      dryRun: true,
    });
    assert.equal(posted, false);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.payload.type, 'template');
    assert.equal(dry.payload.template.name, 'hello_world');
    assert.equal(dry.payload.template.language_code, 'en_US');

    const payload = buildWhatsAppTemplatePayload({
      to: '0711000000',
      templateName: APPROVED_FIRST_TEMPLATE,
      language: 'en',
      parameters: ['Line one', 'Line two', 'Line three'],
    });
    assert.equal(payload.template.name, 'scalers_staff_alert');
    assert.deepEqual(
      payload.template.components[0].parameters.map((p) => p.text),
      ['Line one', 'Line two', 'Line three']
    );
  });

  it('retries the approved first template when the kind name is missing', async () => {
    process.env.SAUTIKIT_API_KEY = 'k';
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = 'num-1';
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_ESCALATION = 'scalers_escalation';
    const urls = [];
    mock.method(global, 'fetch', async (_url, init) => {
      const posted = JSON.parse(init.body);
      urls.push(posted.template.name + ':' + posted.template.language_code);
      if (posted.template.name === 'scalers_escalation') {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ error: { code: 132001, message: 'template name does not exist' } }),
        };
      }
      return {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({ messages: [{ id: 'wamid.FALLBACK' }] }),
      };
    });
    const json = await sendOwnerWhatsApp({
      to: '254711000000',
      kind: 'escalation',
      windowOpen: false,
      body: 'Escalation for Wanjiku. Shop\nCaller: Jane',
      lead: { businessName: 'Shop', name: 'Jane', callerNumber: '254711', reason: 'Ask' },
    });
    assert.equal(urls[0], 'scalers_escalation:en_US');
    assert.ok(urls.includes('scalers_staff_alert:en_US'));
    assert.equal(json.messageId, 'wamid.FALLBACK');
  });

  it('maps 24h-window and template errors', () => {
    assert.equal(
      mapWhatsAppSendError(400, { error: { code: 131047, message: 'outside 24 hour window' } }, '')
        .reason,
      'outside_24h_window'
    );
    assert.equal(
      mapWhatsAppSendError(404, { error: { code: 132001, message: 'template name does not exist' } }, '')
        .reason,
      'template_not_found'
    );
    assert.equal(
      mapWhatsAppSendError(400, { error: { code: 132000, message: 'parameter count' } }, '').reason,
      'template_param_mismatch'
    );
    assert.equal(mapWhatsAppSendError(503, {}, 'upstream down').reason, 'upstream');
  });

  it('sendWhatsAppTemplate maps a failed POST', async () => {
    process.env.SAUTIKIT_API_KEY = 'k';
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = 'num-1';
    mock.method(global, 'fetch', async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { code: 132001, message: 'template name does not exist' } }),
    }));
    await assert.rejects(
      () =>
        sendWhatsAppTemplate({
          to: '254711000000',
          templateName: 'not_approved_yet',
          parameters: ['A', 'B', 'C'],
        }),
      (err) => {
        assert.equal(err.reason, 'template_not_found');
        assert.equal(err.status, 400);
        return true;
      }
    );
  });
});
