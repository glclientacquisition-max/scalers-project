const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID,
  isWhatsAppEventKind,
  isWhatsAppCallingChange,
  routePlatformWhatsApp,
  parseWhatsAppReceived,
  createWhatsAppDedupe,
  isWhatsAppSessionOpen,
  processWhatsAppReceived,
  normalizeWhatsAppContactId,
} = require('../src/sautikit/whatsappInbound');
const {
  buildWhatsAppSendPayload,
  platformWhatsAppSender,
} = require('../src/notifications/whatsapp');

const PLATFORM_PNID = '1237105982825100';
const SAUTIKIT_NUMBER_ID = '81424fbd-8f4c-459a-858d-98ced4393df6';

function metaInbound({ phoneNumberId = PLATFORM_PNID, wamid = 'wamid.IN1', from = '254790381872', body = 'Hello Scalers' } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '254709221536',
                phone_number_id: phoneNumberId,
              },
              contacts: [{ profile: { name: 'Owner' }, wa_id: from }],
              messages: [
                {
                  from,
                  id: wamid,
                  timestamp: '1720000000',
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('whatsapp inbound parse and route', () => {
  it('reads event kind from X-Sautikit-Event-Kind, not the DID', () => {
    assert.equal(
      isWhatsAppEventKind({
        headers: { 'x-sautikit-event-kind': 'whatsapp.event.received' },
        body: { CallSid: 'CA123' },
      }),
      true
    );
    assert.equal(
      isWhatsAppEventKind({
        headers: {},
        body: { event_kind: 'call.completed' },
      }),
      false
    );
  });

  it('maps Meta phone_number_id 1237105982825100 to platform, not resolveTenantId', () => {
    assert.equal(PLATFORM_WHATSAPP_PHONE_NUMBER_ID, '1237105982825100');
    const hit = routePlatformWhatsApp('1237105982825100');
    assert.equal(hit.identity, 'platform');
    assert.equal(hit.ignore, false);
    const miss = routePlatformWhatsApp('999');
    assert.equal(miss.ignore, true);
    assert.equal(miss.reason, 'not_platform_waba');
  });

  it('ignores WhatsApp Calling payloads', () => {
    assert.equal(isWhatsAppCallingChange({ field: 'calls', value: { calls: [{ id: 'c1' }] } }), true);
    assert.equal(
      isWhatsAppCallingChange({ field: 'messages', value: { messages: [{ type: 'text' }] } }),
      false
    );
  });

  it('extracts inbound messages and statuses from a Meta envelope', () => {
    const parsed = parseWhatsAppReceived(metaInbound());
    assert.equal(parsed.inbound.length, 1);
    assert.equal(parsed.inbound[0].wamid, 'wamid.IN1');
    assert.equal(parsed.inbound[0].from, '254790381872');
    assert.equal(parsed.inbound[0].phoneNumberId, PLATFORM_PNID);
    assert.equal(parsed.inbound[0].body, 'Hello Scalers');
    assert.equal(parsed.calling.length, 0);
  });

  it('extracts inbound from a SautiKit workspace { kind, data } envelope', () => {
    const parsed = parseWhatsAppReceived({
      kind: 'whatsapp.event.received',
      event_id: '139367a7-0bee-40e5-9d49-ed9026a93a8f',
      workspace_id: 'ws-1',
      occurred_at: '2026-09-17T11:40:15.000Z',
      data: {
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: '254709221536',
          phone_number_id: PLATFORM_PNID,
        },
        contacts: [{ profile: { name: 'Owner' }, wa_id: '254790381872' }],
        messages: [
          {
            from: '254790381872',
            id: 'wamid.SAUTI3',
            timestamp: '1720000000',
            type: 'text',
            text: { body: 'Hi' },
          },
        ],
      },
    });
    assert.equal(parsed.inbound.length, 1);
    assert.equal(parsed.inbound[0].wamid, 'wamid.SAUTI3');
    assert.equal(parsed.inbound[0].phoneNumberId, PLATFORM_PNID);
    assert.equal(parsed.inbound[0].body, 'Hi');
  });

  it('extracts inbound from a SautiKit value object (no entry wrapper)', () => {
    const value = {
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '254709221536',
        phone_number_id: PLATFORM_PNID,
      },
      contacts: [{ profile: { name: 'Owner' }, wa_id: '254790381872' }],
      messages: [
        {
          from: '254790381872',
          id: 'wamid.SAUTI1',
          timestamp: '1720000000',
          type: 'text',
          text: { body: 'Hi from owner' },
        },
      ],
    };
    const parsed = parseWhatsAppReceived(value);
    assert.equal(parsed.inbound.length, 1);
    assert.equal(parsed.inbound[0].wamid, 'wamid.SAUTI1');
    assert.equal(parsed.inbound[0].from, '254790381872');
    assert.equal(parsed.inbound[0].phoneNumberId, PLATFORM_PNID);
    assert.equal(parsed.inbound[0].body, 'Hi from owner');
  });

  it('extracts delivery statuses from a SautiKit value object', () => {
    const parsed = parseWhatsAppReceived({
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '254709221536',
        phone_number_id: PLATFORM_PNID,
      },
      statuses: [
        {
          id: 'wamid.OUT1',
          status: 'delivered',
          timestamp: '1720000001',
          recipient_id: '254790381872',
        },
      ],
    });
    assert.equal(parsed.inbound.length, 0);
    assert.equal(parsed.statuses.length, 1);
    assert.equal(parsed.statuses[0].wamid, 'wamid.OUT1');
    assert.equal(parsed.statuses[0].status, 'delivered');
  });

  it('dedupes on messages[].id', () => {
    const seen = createWhatsAppDedupe();
    assert.equal(seen.remember('wamid.IN1'), false);
    assert.equal(seen.remember('wamid.IN1'), true);
    assert.equal(seen.remember('wamid.IN2'), false);
  });

  it('treats 24h after inbound as an open customer-service window', () => {
    const inbound = new Date('2026-09-17T10:00:00.000Z');
    assert.equal(isWhatsAppSessionOpen(inbound, new Date('2026-09-17T20:00:00.000Z')), true);
    assert.equal(isWhatsAppSessionOpen(inbound, new Date('2026-09-18T10:00:01.000Z')), false);
    assert.equal(isWhatsAppSessionOpen(null, new Date()), false);
  });
});

describe('processWhatsAppReceived', () => {
  it('persists, marks read, and replies with text on the platform number', async () => {
    const persist = [];
    const reads = [];
    const sends = [];
    const result = await processWhatsAppReceived({
      body: metaInbound(),
      headers: { 'x-sautikit-event-kind': 'whatsapp.event.received' },
      persistInbound: async (row) => {
        persist.push(row);
        return { ok: true, duplicate: false };
      },
      markRead: async (wamid) => {
        reads.push(wamid);
        return { ok: true };
      },
      sendText: async (payload) => {
        sends.push(payload);
        return { ok: true };
      },
    });
    assert.equal(result.handled, 1);
    assert.equal(persist[0].identity, 'platform');
    assert.equal(persist[0].phoneNumberId, PLATFORM_PNID);
    assert.equal(reads[0], 'wamid.IN1');
    assert.equal(sends[0].to, '254790381872');
    assert.equal(sends[0].type, 'text');
    assert.match(sends[0].body, /Scalers/);
    assert.doesNotMatch(sends[0].body, /Done and Dusted/i);
  });

  it('maps inbound from / wa_id to Kenya E.164 digits', async () => {
    assert.equal(normalizeWhatsAppContactId('+254790381872'), '254790381872');
    assert.equal(normalizeWhatsAppContactId('0790381872'), '254790381872');
    assert.equal(normalizeWhatsAppContactId('790381872'), '254790381872');
    const persist = [];
    const sends = [];
    await processWhatsAppReceived({
      body: metaInbound({ from: '+254790381872' }),
      persistInbound: async (row) => {
        persist.push(row);
        return { ok: true, duplicate: false };
      },
      markRead: async () => ({ ok: true }),
      sendText: async (payload) => {
        sends.push(payload);
        return { ok: true };
      },
    });
    assert.equal(persist[0].contactWaId, '254790381872');
    assert.equal(sends[0].to, '254790381872');
  });

  it('handles a SautiKit workspace envelope the same as a Graph envelope', async () => {
    const persist = [];
    const sends = [];
    const result = await processWhatsAppReceived({
      body: {
        kind: 'whatsapp.event.received',
        event_id: 'bc2ccfd7-5121-4fee-908f-94ccd02180ae',
        data: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '254709221536',
            phone_number_id: PLATFORM_PNID,
          },
          contacts: [{ profile: { name: 'Owner' }, wa_id: '254790381872' }],
          messages: [
            {
              from: '254790381872',
              id: 'wamid.SAUTI4',
              timestamp: '1720000000',
              type: 'text',
              text: { body: 'Hello' },
            },
          ],
        },
      },
      persistInbound: async (row) => {
        persist.push(row);
        return { ok: true, duplicate: false };
      },
      markRead: async () => ({ ok: true }),
      sendText: async (payload) => {
        sends.push(payload);
        return { ok: true };
      },
    });
    assert.equal(result.handled, 1);
    assert.equal(persist[0].wamid, 'wamid.SAUTI4');
    assert.equal(sends[0].to, '254790381872');
  });

  it('handles a SautiKit value-object inbound the same as a Graph envelope', async () => {
    const persist = [];
    const sends = [];
    const result = await processWhatsAppReceived({
      body: {
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: '254709221536',
          phone_number_id: PLATFORM_PNID,
        },
        contacts: [{ profile: { name: 'Owner' }, wa_id: '254790381872' }],
        messages: [
          {
            from: '254790381872',
            id: 'wamid.SAUTI2',
            timestamp: '1720000000',
            type: 'text',
            text: { body: 'Hello' },
          },
        ],
      },
      persistInbound: async (row) => {
        persist.push(row);
        return { ok: true, duplicate: false };
      },
      markRead: async () => ({ ok: true }),
      sendText: async (payload) => {
        sends.push(payload);
        return { ok: true };
      },
    });
    assert.equal(result.handled, 1);
    assert.equal(persist[0].wamid, 'wamid.SAUTI2');
    assert.equal(sends[0].to, '254790381872');
  });

  it('does not handle shop phone_number_id as Done and Dusted voice tenant', async () => {
    const persist = [];
    const result = await processWhatsAppReceived({
      body: metaInbound({ phoneNumberId: '000111' }),
      persistInbound: async (row) => persist.push(row),
      markRead: async () => {},
      sendText: async () => {},
    });
    assert.equal(result.ignored, 1);
    assert.equal(persist.length, 0);
  });

  it('skips duplicate wamid so the owner is not double-acked', async () => {
    const seen = createWhatsAppDedupe();
    const sends = [];
    const body = metaInbound();
    const opts = {
      body,
      dedupe: seen,
      persistInbound: async () => ({ ok: true, duplicate: false }),
      markRead: async () => ({ ok: true }),
      sendText: async (payload) => {
        sends.push(payload);
        return { ok: true };
      },
    };
    await processWhatsAppReceived(opts);
    await processWhatsAppReceived(opts);
    assert.equal(sends.length, 1);
  });
});

describe('platform send payload', () => {
  const envKeys = [
    'SAUTIKIT_WHATSAPP_NUMBER_ID',
    'SAUTIKIT_WHATSAPP_CONNECTION_ID',
    'SAUTIKIT_WHATSAPP_TEMPLATE',
    'SAUTIKIT_WHATSAPP_TEMPLATE_LANG',
    'SAUTIKIT_WHATSAPP_TEMPLATE_ALLOW_LEGACY',
  ];
  /** @type {Record<string, string|undefined>} */
  let saved = {};

  beforeEach(() => {
    saved = {};
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = SAUTIKIT_NUMBER_ID;
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('originates with the platform SautiKit number_id, never a shop DID', () => {
    const sender = platformWhatsAppSender();
    assert.equal(sender.number_id, SAUTIKIT_NUMBER_ID);
    const payload = buildWhatsAppSendPayload({
      to: '0709221536',
      body: 'Lead',
      windowOpen: false,
      lead: { name: 'Ann', callerNumber: '254711', reason: 'Quote' },
    });
    assert.equal(payload.number_id, SAUTIKIT_NUMBER_ID);
    assert.equal(payload.to, '254709221536');
    assert.equal('from' in payload, false);
  });

  it('uses the approved first template when originating outside the window', () => {
    const payload = buildWhatsAppSendPayload({
      to: '254790381872',
      body: 'ignored',
      windowOpen: false,
      lead: { name: 'Ann', callerNumber: '254711', reason: 'Quote' },
    });
    assert.equal(payload.type, 'template');
    assert.equal(payload.template.name, 'scalers_staff_alert');
    assert.equal(payload.template.language_code, 'en');
    assert.equal(payload.template.components[0].parameters.length, 3);
  });

  it('uses a legacy name only when explicitly allowed', () => {
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE = 'missed_call_lead';
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_LANG = 'en';
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE_ALLOW_LEGACY = 'on';
    const payload = buildWhatsAppSendPayload({
      to: '254790381872',
      body: 'ignored',
      windowOpen: false,
      lead: { name: 'Ann', callerNumber: '254711', reason: 'Quote' },
    });
    assert.equal(payload.type, 'template');
    assert.equal(payload.template.name, 'missed_call_lead');
    assert.equal(payload.template.components[0].parameters[0].text, 'Ann');
  });

  it('uses type=text inside the 24h window even if a template is configured', () => {
    process.env.SAUTIKIT_WHATSAPP_TEMPLATE = 'scalers_staff_alert';
    const payload = buildWhatsAppSendPayload({
      to: '254790381872',
      body: 'Got it. A Scalers teammate will follow up.',
      windowOpen: true,
    });
    assert.equal(payload.type, 'text');
    assert.equal(payload.text.body, 'Got it. A Scalers teammate will follow up.');
  });
});

describe('voice host wiring', () => {
  it('demuxes WhatsApp on the voice host without using resolveTenantId for inbound chat', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(source, /\/whatsapp\/events/);
    assert.match(source, /whatsapp\.event\.received/);
    assert.match(source, /isWhatsAppEventKind/);
    assert.match(source, /Do not resolveTenantId\(DID\)/);
  });
});
