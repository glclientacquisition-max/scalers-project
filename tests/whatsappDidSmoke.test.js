const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeKenyaDid,
  listFromPayload,
  matchNumber,
  isTrunkActive,
  probeWhatsAppDid,
} = require('../src/sautikit/whatsappDid');

describe('whatsapp DID smoke helpers', () => {
  it('normalizes local 07 and E.164 Kenya DIDs', () => {
    assert.equal(normalizeKenyaDid('0709221536'), '+254709221536');
    assert.equal(normalizeKenyaDid('+254709221536'), '+254709221536');
    assert.equal(normalizeKenyaDid('254709221536'), '+254709221536');
    assert.equal(normalizeKenyaDid('709221536'), '+254709221536');
  });

  it('reads both data and numbers list envelopes', () => {
    assert.equal(listFromPayload({ data: [{ id: 'a' }] }).length, 1);
    assert.equal(listFromPayload({ numbers: [{ id: 'b' }] })[0].id, 'b');
  });

  it('matches the staging DID among workspace numbers', () => {
    const numbers = [
      { id: '1', e164: '+254700000000' },
      { id: '2', e164: '+254709221536' },
    ];
    assert.equal(matchNumber(numbers, '0709221536').id, '2');
  });

  it('treats trunk status active as live WhatsApp', () => {
    assert.equal(isTrunkActive({ status: 'active' }), true);
    assert.equal(isTrunkActive({ status: 'pending' }), false);
    assert.equal(isTrunkActive({ status: 'failed' }), false);
    assert.equal(isTrunkActive({ status: 'pending', readiness: { status: 'AVAILABLE' } }), true);
  });
});

describe('probeWhatsAppDid', () => {
  afterEach(() => mock.restoreAll());

  it('reports active when GET /whatsapp returns an active trunk', async () => {
    mock.method(global, 'fetch', async (url) => {
      const href = String(url);
      if (href.endsWith('/v1/numbers')) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({ data: [{ id: 'num-1', e164: '+254709221536', status: 'active' }] }),
        };
      }
      if (href.includes('/whatsapp/call-settings')) {
        return { status: 200, text: async () => JSON.stringify({ hours: 'always' }) };
      }
      if (href.endsWith('/whatsapp')) {
        return {
          status: 200,
          text: async () => JSON.stringify({ status: 'active', external_id: '1098', provider: 'whatsapp' }),
        };
      }
      throw new Error(`unexpected ${href}`);
    });

    const prev = process.env.SAUTIKIT_API_KEY;
    process.env.SAUTIKIT_API_KEY = 'test-key';
    try {
      const result = await probeWhatsAppDid({ did: '0709221536' });
      assert.equal(result.active, true);
      assert.equal(result.e164, '+254709221536');
      assert.equal(result.trunk.status, 'active');
      assert.equal(result.ok, true);
    } finally {
      if (prev === undefined) delete process.env.SAUTIKIT_API_KEY;
      else process.env.SAUTIKIT_API_KEY = prev;
    }
  });

  it('fails closed on 404 no trunk', async () => {
    mock.method(global, 'fetch', async (url) => {
      const href = String(url);
      if (href.endsWith('/v1/numbers')) {
        return {
          status: 200,
          text: async () => JSON.stringify({ numbers: [{ id: 'num-1', e164: '+254709221536' }] }),
        };
      }
      return { status: 404, text: async () => JSON.stringify({ error: { code: 'not_found' } }) };
    });
    process.env.SAUTIKIT_API_KEY = 'test-key';
    const result = await probeWhatsAppDid({ did: '+254709221536' });
    assert.equal(result.active, false);
    assert.equal(result.trunkHttpStatus, 404);
    assert.equal(result.ok, true);
  });
});
