// Unit tests for webhook / HTTP log redaction (TD-P1-4).
// Run: node --test tests/requestLog.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeHeaders,
  summarizeHeaders,
  summarizeBody,
  summarizeWsPayload,
  createWsPayloadSampler,
  isSensitiveKey,
} = require('../src/sautikit/safeLog');

describe('sanitizeHeaders', () => {
  it('redacts authorization, cookies, and SautiKit signatures', () => {
    const out = sanitizeHeaders({
      host: 'example.com',
      authorization: 'Bearer secret-token',
      cookie: 'session=abc',
      'x-sautikit-signature': 't=1,v1=deadbeef',
      'x-voice-internal-secret': 'internal',
      'content-type': 'application/json',
    });
    assert.equal(out.host, 'example.com');
    assert.equal(out.authorization, '[redacted]');
    assert.equal(out.cookie, '[redacted]');
    assert.equal(out['x-sautikit-signature'], '[redacted]');
    assert.equal(out['x-voice-internal-secret'], '[redacted]');
    assert.equal(out['content-type'], 'application/json');
  });
});

describe('summarizeHeaders', () => {
  it('keeps allowlisted operational headers only', () => {
    const out = summarizeHeaders({
      host: 'voice.example',
      'content-type': 'application/json',
      authorization: 'Bearer secret',
      'x-custom-debug': 'leave-out',
      'x-sautikit-event-kind': 'call.completed',
    });
    assert.equal(out.host, 'voice.example');
    assert.equal(out['content-type'], 'application/json');
    assert.equal(out.authorization, '[redacted]');
    assert.equal(out['x-sautikit-event-kind'], 'call.completed');
    assert.equal(out['x-custom-debug'], undefined);
  });
});

describe('summarizeBody', () => {
  it('omits caller phone/name and keeps callSid / event kind', () => {
    const out = summarizeBody({
      CallSid: 'CA123',
      From: '+254700000000',
      To: '+254711111111',
      CallerName: 'Jane Doe',
      callSessionState: 'ringing',
      kind: 'call.completed',
      nested: { email: 'jane@example.com', duration: 42 },
    });
    assert.ok(out.keys.includes('CallSid'));
    assert.ok(out.keys.includes('From'));
    assert.equal(out.fields.CallSid, 'CA123');
    assert.equal(out.fields.kind, 'call.completed');
    assert.equal(out.fields.callSessionState, 'ringing');
    assert.equal(out.fields['nested.duration'], 42);
    const blob = JSON.stringify(out);
    assert.equal(blob.includes('+254700000000'), false);
    assert.equal(blob.includes('Jane Doe'), false);
    assert.equal(blob.includes('jane@example.com'), false);
    assert.equal(isSensitiveKey('From'), true);
  });

  it('truncates non-object bodies', () => {
    const out = summarizeBody('x'.repeat(500));
    assert.ok(String(out.fields.value).length < 500);
  });
});

describe('summarizeWsPayload', () => {
  it('returns event type, keys, and callSid without dumping media', () => {
    const out = summarizeWsPayload({
      event: 'start',
      streamSid: 'MZ1',
      metadata: { callSid: 'CA99', from: '+254700000000' },
      media: { payload: 'AAAA' },
    });
    assert.equal(out.event, 'start');
    assert.equal(out.callSid, 'CA99');
    assert.ok(out.keys.includes('event'));
    assert.ok(out.keys.includes('media'));
    assert.equal(JSON.stringify(out).includes('AAAA'), false);
    assert.equal(JSON.stringify(out).includes('+254700000000'), false);
  });
});

describe('createWsPayloadSampler', () => {
  it('samples the first N frames then returns null', () => {
    const sample = createWsPayloadSampler(2);
    assert.equal(sample({ event: 'a' }).sample, 1);
    assert.equal(sample({ event: 'b' }).sample, 2);
    assert.equal(sample({ event: 'c' }), null);
  });
});
