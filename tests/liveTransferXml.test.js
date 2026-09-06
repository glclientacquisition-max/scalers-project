const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDialXml,
  buildTransferFallbackXml,
  buildAnswerStreamXml,
  queuePendingLiveTransfer,
  consumeLiveTransferWebhook,
  resetPendingLiveTransfersForTests,
  conferenceRoomName,
  buildAnswerConferenceHoldXml,
  buildAgentJoinConferenceXml,
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
      mode: 'cold_dial',
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
      mode: 'cold_dial',
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
      mode: 'cold_dial',
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

  it('builds Stream without connect plus Conference hold', () => {
    const room = conferenceRoomName('HD_6f9424c1289a');
    const xml = buildAnswerConferenceHoldXml({
      streamUrl: 'wss://example.test/ws/media?callSid=HD_6f9424c1289a',
      room,
    });
    assert.match(xml, /connect="false"/);
    assert.match(xml, /<Conference startOnEnter="true" endOnExit="false"/);
    assert.match(xml, new RegExp(`>${room}</Conference>`));
  });

  it('builds agent join Conference XML', () => {
    const xml = buildAgentJoinConferenceXml({ room: 'xfer6f9424c1289a' });
    assert.match(xml, /<Say>You have a caller on the line\.<\/Say>/);
    assert.match(xml, />xfer6f9424c1289a<\/Conference>/);
  });

  it('does not return Dial on Completed when pending is conference', () => {
    queuePendingLiveTransfer({
      callSid: 'CA5',
      to: '+254712345678',
      callerId: '+254709221536',
      mode: 'conference',
      room: 'xferca5',
    });
    const hit = consumeLiveTransferWebhook({
      callSid: 'CA5',
      callSessionState: 'Completed',
      body: {},
    });
    assert.equal(hit, null);
  });
});
