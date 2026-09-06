const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { originateOutboundCall } = require('../src/sautikit/voiceApi');

describe('sautikit outbound originate', () => {
  it('posts to /v1/calls with to as an array', async () => {
    const prev = process.env.SAUTIKIT_API_KEY;
    process.env.SAUTIKIT_API_KEY = 'test-key';
    let captured = null;
    const fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return {
        status: 201,
        text: async () =>
          JSON.stringify({ call_id: 'uuid-1', session_id: 'HD_out', status: 'ringing' }),
      };
    };
    try {
      const result = await originateOutboundCall({
        from: '+254709221536',
        to: '+254790381872',
        voiceCallbackUrl: 'https://example.test/voice/transfer-agent?inbound=HD_in&room=xfer1',
        clientRequestId: 'xfer-HD_in',
        fetchImpl,
      });
      assert.equal(result.ok, true);
      assert.equal(result.sessionId, 'HD_out');
      assert.match(captured.url, /\/v1\/calls$/);
      const body = JSON.parse(captured.opts.body);
      assert.deepEqual(body.to, ['+254790381872']);
      assert.equal(body.from, '+254709221536');
      assert.match(body.voice_callback_url, /transfer-agent/);
    } finally {
      if (prev == null) delete process.env.SAUTIKIT_API_KEY;
      else process.env.SAUTIKIT_API_KEY = prev;
    }
  });

  it('fails closed without an API key', async () => {
    const prev = process.env.SAUTIKIT_API_KEY;
    delete process.env.SAUTIKIT_API_KEY;
    try {
      const result = await originateOutboundCall({
        from: '+254709221536',
        to: '+254790381872',
        voiceCallbackUrl: 'https://example.test/voice/transfer-agent',
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'no_api_key');
    } finally {
      if (prev == null) delete process.env.SAUTIKIT_API_KEY;
      else process.env.SAUTIKIT_API_KEY = prev;
    }
  });
});
