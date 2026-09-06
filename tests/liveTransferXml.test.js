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
