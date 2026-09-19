// Run: node --test tests/recordingEvents.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractEventKind,
  extractEventCallSids,
  extractRecordingFields,
  isRecordingEvent,
} = require('../src/sautikit/recordingEvents');
const { fetchCallRecording } = require('../src/sautikit/recordingFetch');

describe('SautiKit recording.ready payloads', () => {
  it('reads kind, call_id, and download_url from the documented envelope', () => {
    const body = {
      kind: 'call.recording.ready',
      data: {
        call_id: '01900000-0000-7000-8000-000000000003',
        recording_id: '01900000-0000-7000-8000-000000000005',
        download_url: 'https://storage.example.com/recordings/a.wav?X-Amz-Expires=3600',
      },
    };
    assert.equal(extractEventKind({}, body), 'call.recording.ready');
    assert.equal(isRecordingEvent('call.recording.ready', body), true);
    assert.deepEqual(extractEventCallSids(body), [
      '01900000-0000-7000-8000-000000000003',
    ]);
    const rec = extractRecordingFields(body);
    assert.equal(
      rec.recordingUrl,
      'https://storage.example.com/recordings/a.wav?X-Amz-Expires=3600'
    );
    assert.equal(rec.recordingSid, '01900000-0000-7000-8000-000000000005');
  });

  it('reads event_kind + payload.call_id when the URL is omitted', () => {
    const headers = { 'x-sautikit-event': 'call.recording.ready' };
    const body = {
      event_kind: 'call.recording.ready',
      payload: {
        call_id: '01900000-0000-7000-8000-000000000003',
        recording_duration_seconds: 72,
      },
    };
    assert.equal(extractEventKind(headers, body), 'call.recording.ready');
    assert.equal(isRecordingEvent('', body), true);
    const rec = extractRecordingFields(body);
    assert.equal(rec.recordingUrl, null);
    assert.deepEqual(extractEventCallSids(body), [
      '01900000-0000-7000-8000-000000000003',
    ]);
  });

  it('prefers sessionId when both HD session and UUID call_id are present', () => {
    const body = {
      kind: 'call.recording.ready',
      sessionId: 'HD_5e88032953d2',
      data: {
        call_id: '01900000-0000-7000-8000-000000000003',
        download_url: 'https://storage.example.com/rec.wav',
      },
    };
    assert.deepEqual(extractEventCallSids(body), [
      'HD_5e88032953d2',
      '01900000-0000-7000-8000-000000000003',
    ]);
  });
});

describe('fetchCallRecording', () => {
  it('returns the 302 Location as the download URL and session_id from the call', async () => {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
      calls.push({ url: String(url), redirect: opts.redirect });
      if (String(url).endsWith('/recording')) {
        return {
          status: 302,
          ok: false,
          headers: { get: (name) => (name.toLowerCase() === 'location' ? 'https://cdn.example/r.wav' : null) },
          json: async () => ({}),
        };
      }
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({ id: 'call-uuid', session_id: 'HD_5e88032953d2' }),
      };
    };
    const out = await fetchCallRecording('call-uuid', {
      apiKey: 'test-key',
      apiBase: 'https://api.sautikit.com',
      fetchImpl,
    });
    assert.equal(out.downloadUrl, 'https://cdn.example/r.wav');
    assert.equal(out.sessionId, 'HD_5e88032953d2');
    assert.equal(out.status, 302);
    assert.ok(calls[0].url.includes('/v1/calls/call-uuid/recording'));
    assert.equal(calls[0].redirect, 'manual');
  });

  it('treats 404 as no recording without throwing', async () => {
    const out = await fetchCallRecording('call-uuid', {
      apiKey: 'test-key',
      apiBase: 'https://api.sautikit.com',
      fetchImpl: async () => ({
        status: 404,
        ok: false,
        headers: { get: () => null },
        json: async () => ({ error: { code: 'calls.recording_not_found' } }),
      }),
    });
    assert.equal(out.downloadUrl, null);
    assert.equal(out.status, 404);
  });

  it('skips the network when no API key is configured', async () => {
    const out = await fetchCallRecording('call-uuid', {
      apiKey: '',
      fetchImpl: async () => {
        throw new Error('should not fetch');
      },
    });
    assert.equal(out.downloadUrl, null);
    assert.equal(out.status, 'not_configured');
  });
});
