const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDialXml,
  buildTransferFallbackXml,
  buildAnswerStreamXml,
  queuePendingLiveTransfer,
  consumeLiveTransferWebhook,
  resetPendingLiveTransfersForTests,
} = require('../src/sautikit/pendingLiveTransfer');

describe('live transfer Dial XML', () => {
  beforeEach(() => resetPendingLiveTransfersForTests());

  it('builds Dial XML with tenant callerId', () => {
    const xml = buildDialXml({
      to: '+254712345678',
      callerId: '+254709221536',
      timeoutS: 30,
    });
    assert.match(xml, /<Dial callerId="\+254709221536" timeout="30" record="true">/);
    assert.match(xml, /<Number>\+254712345678<\/Number>/);
  });

  it('returns Dial on StreamStopped then empty while ringing', () => {
    queuePendingLiveTransfer({
      callSid: 'CA1',
      to: '+254712345678',
      callerId: '+254709221536',
    });
    const first = consumeLiveTransferWebhook({
      callSid: 'CA1',
      callSessionState: 'StreamStopped',
      body: {},
    });
    assert.equal(first.action, 'dial');
    assert.match(first.xml, /<Dial/);

    const second = consumeLiveTransferWebhook({
      callSid: 'CA1',
      callSessionState: 'Completed',
      body: { streamEvent: 'stream-stopped' },
    });
    assert.equal(second.action, 'wait');
    assert.match(second.xml, /<Response><\/Response>/);
  });

  it('returns fallback Say on Dial busy', () => {
    queuePendingLiveTransfer({
      callSid: 'CA2',
      to: '+254712345678',
      callerId: '+254709221536',
    });
    consumeLiveTransferWebhook({
      callSid: 'CA2',
      callSessionState: 'StreamStopped',
      body: {},
    });
    const fail = consumeLiveTransferWebhook({
      callSid: 'CA2',
      callSessionState: 'busy',
      body: {},
    });
    assert.equal(fail.action, 'fallback');
    assert.match(fail.xml, /<Say>/);
    assert.match(fail.xml, /<Hangup\/>/);
    assert.match(buildTransferFallbackXml(), /follow up/);
  });

  it('returns Dial on post-Stream Redirect continue', () => {
    queuePendingLiveTransfer({
      callSid: 'CA3',
      to: '+254712345678',
      callerId: '+254709221536',
    });
    const first = consumeLiveTransferWebhook({
      callSid: 'CA3',
      callSessionState: '',
      body: {},
      source: 'transfer_continue',
    });
    assert.equal(first.action, 'dial');
    assert.match(first.xml, /<Dial/);
  });

  it('builds Stream then Redirect so Dial can run after WS close', () => {
    const xml = buildAnswerStreamXml({
      streamUrl: 'wss://example.test/ws/media?callSid=CA4',
      continueUrl: 'https://example.test/voice/transfer?callSid=CA4',
    });
    assert.match(xml, /<Stream url="wss:\/\/example.test\/ws\/media\?callSid=CA4"/);
    assert.match(xml, /connect="true"/);
    assert.match(
      xml,
      /<Redirect method="POST">https:\/\/example.test\/voice\/transfer\?callSid=CA4<\/Redirect>/
    );
  });
});

describe('VOICE_STREAM_RECORD on the inbound AI Stream', () => {
  const { buildAnswerStreamXml: build, streamRecordEnabled } = require('../src/sautikit/pendingLiveTransfer');
  const args = { streamUrl: 'wss://x.example/ws/media?callSid=HD_1', continueUrl: 'https://x.example/voice/continue' };
  it('flag off (default): no record attribute', () => {
    const prev = process.env.VOICE_STREAM_RECORD;
    delete process.env.VOICE_STREAM_RECORD;
    try {
      assert.equal(streamRecordEnabled(), false);
      assert.ok(!build(args).includes('record='));
    } finally { if (prev !== undefined) process.env.VOICE_STREAM_RECORD = prev; }
  });
  it('flag on: record="true" on <Stream>, connect stays', () => {
    const xml = build({ ...args, record: streamRecordEnabled({ VOICE_STREAM_RECORD: '1' }) });
    assert.match(xml, /<Stream [^>]*connect="true"[^>]*record="true" \/>/);
    assert.equal((xml.match(/record="true"/g) || []).length, 1);
  });
});

describe('call.recording.ready from a recorded Stream', () => {
  const { isRecordingEvent, extractRecordingFields } = require('../src/sautikit/recordingEvents');
  it('is a recording event with or without a URL (no URL -> fetch path)', () => {
    const withUrl = { event: 'call.recording.ready', data: { call_id: 'u-1', session_id: 'HD_1', recording: { id: 'rec_1', url: 'https://cdn.example/r.wav' } } };
    const noUrl = { event: 'call.recording.ready', data: { call_id: 'u-1', session_id: 'HD_1', recording: { id: 'rec_1' } } };
    assert.equal(isRecordingEvent('call.recording.ready', withUrl), true);
    assert.equal(extractRecordingFields(withUrl).recordingUrl, 'https://cdn.example/r.wav');
    assert.equal(isRecordingEvent('call.recording.ready', noUrl), true);
    assert.equal(extractRecordingFields(noUrl).recordingUrl, null);
    assert.equal(extractRecordingFields(noUrl).recordingSid, 'rec_1');
    assert.ok(extractRecordingFields(noUrl).callSids.length > 0);
  });
});
