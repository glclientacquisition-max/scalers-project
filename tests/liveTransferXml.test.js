const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDialXml,
  buildTransferFallbackXml,
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
});
