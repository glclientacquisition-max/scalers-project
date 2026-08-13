// Run: node --test tests/textsmsNotify.test.js
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
  isSmsConfigured,
  normalizeSmsTo,
  sendSms,
  probeSmsCredentials,
  getSmsStatus,
} = require('../src/notifications/sms');
const {
  dispatchAlert,
  dispatchEscalationAlert,
  smsSenderReady,
} = require('../src/notifications/dispatch');

describe('TextSMS helpers', () => {
  it('normalizes local Kenyan mobiles to 254…', () => {
    assert.equal(normalizeSmsTo('0740442943'), '254740442943');
    assert.equal(normalizeSmsTo('+254740442943'), '254740442943');
    assert.equal(normalizeSmsTo('254 740 442 943'), '254740442943');
  });

  it('detects SMS config from env', () => {
    const prev = { ...process.env };
    delete process.env.TEXTSMS_API_KEY;
    delete process.env.TEXTSMS_PARTNER_ID;
    delete process.env.TEXTSMS_SHORTCODE;
    assert.equal(isSmsConfigured(), false);
    process.env.TEXTSMS_API_KEY = 'k';
    process.env.TEXTSMS_PARTNER_ID = '1';
    process.env.TEXTSMS_SHORTCODE = 'SCALERS';
    assert.equal(isSmsConfigured(), true);
    Object.assign(process.env, prev);
  });
});

describe('sendSms + dispatch', () => {
  const envKeys = [
    'TEXTSMS_API_KEY',
    'TEXTSMS_PARTNER_ID',
    'TEXTSMS_SHORTCODE',
    'TEXTSMS_API_URL',
    'SAUTIKIT_API_KEY',
    'SAUTIKIT_WHATSAPP_NUMBER_ID',
    'RESEND_API_KEY',
    'ALERT_EMAIL_FROM',
  ];
  /** @type {Record<string, string|undefined>} */
  let saved = {};

  beforeEach(() => {
    saved = {};
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.TEXTSMS_API_KEY = 'test-key';
    process.env.TEXTSMS_PARTNER_ID = '99';
    process.env.TEXTSMS_SHORTCODE = 'SCALERS';
  });

  afterEach(() => {
    mock.restoreAll();
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('probeSmsCredentials marks verified on balance 200', async () => {
    mock.method(global, 'fetch', async (url) => {
      assert.match(String(url), /getbalance/);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            'response-code': 200,
            'response-description': 'Success',
            credit: 120,
          }),
      };
    });
    const status = await probeSmsCredentials({ force: true });
    assert.equal(status.verified, true);
    assert.equal(status.balance, 120);
    assert.equal(getSmsStatus().verified, true);
  });

  it('probeSmsCredentials marks unverified on 1006', async () => {
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          'response-code': 1006,
          'response-description': 'Invalid credentials',
        }),
    }));
    const status = await probeSmsCredentials({ force: true });
    assert.equal(status.verified, false);
    assert.equal(status.code, 1006);
  });

  it('posts to TextSMS and accepts respose-code 200', async () => {
    const calls = [];
    mock.method(global, 'fetch', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            responses: [
              {
                'respose-code': 200,
                'response-description': 'Success',
                mobile: '254740442943',
                messageid: 123,
                networkid: '1',
              },
            ],
          }),
      };
    });

    const result = await sendSms({
      to: '0740442943',
      body: 'Escalation test',
    });
    assert.equal(result.provider, 'textsms');
    assert.equal(result.messageId, 123);
    assert.equal(calls[0].body.mobile, '254740442943');
    assert.equal(calls[0].body.shortcode, 'SCALERS');
    assert.equal(calls[0].body.partnerID, '99');
  });

  it('dispatchAlert prefers SMS when configured', async () => {
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          responses: [
            {
              'respose-code': 200,
              'response-description': 'Success',
              mobile: '254711000000',
              messageid: 1,
            },
          ],
        }),
    }));

    assert.equal(smsSenderReady(), true);
    const result = await dispatchAlert({
      to: '+254711000000',
      email: 'owner@example.com',
      body: 'New lead',
      lead: { name: 'Jane', reason: 'wants manager' },
    });
    assert.equal(result.channel, 'sms');
    assert.equal(result.to, '254711000000');
  });

  it('dispatchEscalationAlert SMS to teammate and distinct owner', async () => {
    const mobiles = [];
    mock.method(global, 'fetch', async (_url, init) => {
      const body = JSON.parse(init.body);
      mobiles.push(body.mobile);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            responses: [
              {
                'respose-code': 200,
                'response-description': 'Success',
                mobile: body.mobile,
                messageid: mobiles.length,
              },
            ],
          }),
      };
    });

    const sent = await dispatchEscalationAlert({
      teammatePhone: '0740442943',
      ownerPhone: '+254790381872',
      ownerEmail: null,
      body: 'Caller wants Harrison',
      lead: { businessName: 'ChapterOne Bookstore', name: 'Soony' },
    });

    assert.equal(sent.length, 2);
    assert.equal(sent[0].channel, 'sms');
    assert.equal(sent[0].role, 'teammate');
    assert.equal(sent[1].role, 'owner');
    assert.deepEqual(mobiles, ['254740442943', '254790381872']);
  });

  it('dispatchEscalationAlert does not double-SMS identical owner/teammate', async () => {
    let calls = 0;
    mock.method(global, 'fetch', async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            responses: [
              {
                'respose-code': 200,
                'response-description': 'Success',
                mobile: '254740442943',
                messageid: 9,
              },
            ],
          }),
      };
    });

    const sent = await dispatchEscalationAlert({
      teammatePhone: '0740442943',
      ownerPhone: '+254740442943',
      body: 'Same number',
    });
    assert.equal(calls, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].role, 'teammate');
  });
});
