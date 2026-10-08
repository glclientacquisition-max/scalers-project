const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { classifyWalletResponse, probeSautikitWallet } = require('../src/sautikit/walletProbe');
const {
  snapshot,
  resetTelephonyProviderHealth,
  telephonyBillingRejectXml,
  isTelephonyBillingExhausted,
} = require('../src/sautikit/telephonyProviderHealth');

const REJECT_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';
const EMPTY_RESPONSE_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const STREAM_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://example/ws/media" connect="true"></Stream></Connect></Response>';

/**
 * Mirrors handleVoiceIncoming order for the billing gate: lifecycle skip
 * first (empty <Response/>), then telephonyBillingRejectXml(), else Stream.
 * Both real routes (POST / and POST /voice/incoming) share that handler.
 */
function buildGateApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const handler = (req, res) => {
    const state = String(
      req.body?.callSessionState || req.body?.CallSessionState || ''
    ).toLowerCase();
    // Lifecycle re-invoke. Keep empty Response (same as shouldSkipMediaStream path).
    if (state === 'completed' || state === 'streamstarted' || state === 'streamstopped') {
      return res.type('text/xml').send(EMPTY_RESPONSE_XML);
    }
    const telephonyReject = telephonyBillingRejectXml();
    if (telephonyReject) {
      return res.type('text/xml').send(telephonyReject);
    }
    return res.type('text/xml').send(STREAM_XML);
  };
  app.post('/', handler);
  app.post('/voice/incoming', handler);
  return app;
}

function postXml(server, route, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const addr = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: route,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('inbound telephony billing gate', () => {
  beforeEach(() => {
    resetTelephonyProviderHealth();
  });

  it('returns SautiKit Reject XML when the wallet probe marked billing exhausted', () => {
    snapshot({
      billingExhausted: true,
      balanceMinor: 0,
      currency: 'KES',
      message: 'telephony wallet empty',
    });
    assert.equal(telephonyBillingRejectXml(), REJECT_XML);
  });

  it('returns null when billing is healthy so incoming can still Stream', () => {
    snapshot({
      billingExhausted: false,
      balanceMinor: 50000,
      currency: 'KES',
      message: 'ok',
    });
    assert.equal(telephonyBillingRejectXml(), null);
  });

  it('fails open after a probe HTTP 403', () => {
    const row = classifyWalletResponse(403, { message: 'forbidden' }, '');
    snapshot(row);
    assert.equal(row.billingExhausted, false);
    assert.equal(telephonyBillingRejectXml(), null);
  });

  it('fails open when never probed', () => {
    assert.equal(isTelephonyBillingExhausted(), false);
    assert.equal(telephonyBillingRejectXml(), null);
  });

  it('fails open after a probe timeout / fetch error', async () => {
    const result = await probeSautikitWallet({
      apiKey: 'test-key',
      fetchImpl: async () => {
        throw new Error('timeout');
      },
    });
    assert.equal(result.ok, false);
    assert.equal(isTelephonyBillingExhausted(), false);
    assert.equal(telephonyBillingRejectXml(), null);
  });

  it('rejects after an empty prepaid balance', () => {
    const row = classifyWalletResponse(
      200,
      { data: { currency: 'KES', balance_minor: 0 } },
      ''
    );
    snapshot(row);
    assert.equal(telephonyBillingRejectXml(), REJECT_XML);
  });

  it('rejects after a wallet 402', () => {
    const row = classifyWalletResponse(402, { message: 'payment required' }, '');
    snapshot(row);
    assert.equal(telephonyBillingRejectXml(), REJECT_XML);
  });

  it('clears the flag on the next healthy probe so calls resume without a restart', async () => {
    snapshot({
      billingExhausted: true,
      balanceMinor: 0,
      currency: 'KES',
      message: 'telephony wallet empty',
    });
    assert.equal(telephonyBillingRejectXml(), REJECT_XML);

    const result = await probeSautikitWallet({
      apiKey: 'test-key',
      fetchImpl: async () => ({
        status: 200,
        text: async () =>
          JSON.stringify({ data: { currency: 'KES', balance_minor: 1181 } }),
      }),
    });
    assert.equal(result.billingExhausted, false);
    assert.equal(isTelephonyBillingExhausted(), false);
    assert.equal(telephonyBillingRejectXml(), null);
  });
});

describe('inbound billing gate HTTP routes', () => {
  let server;

  beforeEach(async () => {
    resetTelephonyProviderHealth();
    server = await new Promise((resolve) => {
      const s = http.createServer(buildGateApp());
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  for (const route of ['/', '/voice/incoming']) {
    it(`${route} rejects when the wallet is exhausted`, async () => {
      snapshot({
        billingExhausted: true,
        balanceMinor: 0,
        currency: 'KES',
        message: 'telephony wallet empty',
      });
      const res = await postXml(server, route, {
        CallSid: 'CA_test_reject',
        From: '+254700000001',
        To: '+254709221536',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body, REJECT_XML);
    });

    it(`${route} streams normally when the wallet is healthy`, async () => {
      snapshot({
        billingExhausted: false,
        balanceMinor: 50000,
        currency: 'KES',
        message: 'ok',
      });
      const res = await postXml(server, route, {
        CallSid: 'CA_test_stream',
        From: '+254700000001',
        To: '+254709221536',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body, STREAM_XML);
    });

    it(`${route} returns empty Response on Completed lifecycle even when exhausted`, async () => {
      snapshot({
        billingExhausted: true,
        balanceMinor: 0,
        currency: 'KES',
        message: 'telephony wallet empty',
      });
      const res = await postXml(server, route, {
        CallSid: 'CA_test_lifecycle',
        From: '+254700000001',
        To: '+254709221536',
        callSessionState: 'Completed',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body, EMPTY_RESPONSE_XML);
    });
  }
});

describe('inbound billing gate server wiring', () => {
  it('places the wallet Reject after lifecycle skip and before Stream on both routes', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const lifecycleAt = source.indexOf('lifecycle edge — empty <Response/> (no re-Stream)');
    const telephonyRejectAt = source.indexOf('telephonyBillingRejectXml()');
    const answerStreamAt = source.indexOf('const twiml = buildAnswerStreamXml(');
    assert.ok(lifecycleAt > 0, 'lifecycle skip must exist');
    assert.ok(
      telephonyRejectAt > lifecycleAt && telephonyRejectAt < answerStreamAt,
      'exhausted SautiKit prepaid balance must Reject after lifecycle skip and before Stream XML'
    );
    assert.match(
      source,
      /telephony wallet exhausted — reject/,
      'exhausted prepaid balance must log the reject reason'
    );
    assert.match(
      source,
      /app\.post\('\/',\s*sautikitWebhookGuard,\s*handleSautikitRootPost\)/,
      'POST / must route non-WhatsApp posts through handleSautikitRootPost → handleVoiceIncoming'
    );
    assert.match(
      source,
      /app\.post\('\/voice\/incoming',\s*sautikitWebhookGuard,\s*handleVoiceIncoming\)/,
      'POST /voice/incoming must use handleVoiceIncoming (same gate as POST /)'
    );
    assert.match(
      source,
      /function handleSautikitRootPost[\s\S]*return handleVoiceIncoming\(req, res\)/,
      'root POST must fall through to handleVoiceIncoming for voice'
    );
  });
});
