const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  conferenceRoomName,
  clientRequestIdFor,
  buildOriginateBody,
  buildLiveBridgeXml,
  buildHoldConferenceDocument,
  seedConferenceHold,
  armConferenceTransfer,
  decideTransferContinue,
  decideAgentJoin,
  decideConferenceEvent,
  claimOriginate,
  postOutboundTransfer,
  outboundLegResult,
  conferenceKeepsCallOpen,
  resetConferenceTransfersForTests,
  FALLBACK_SAY,
} = require('../src/sautikit/liveTransferConference');

const armed = {
  callSid: 'HD_abc123',
  to: '+254712345678',
  callerId: '+254709221536',
  callerNumber: '+254715715894',
  timeoutS: 30,
  eventsUrl: 'https://voice.test/voice/conference-events?callSid=HD_abc123',
  agentUrl: 'https://voice.test/voice/transfer-agent?callSid=HD_abc123',
  fallbackUrl: 'https://voice.test/voice/transfer-fallback?callSid=HD_abc123',
  billingEnforcement: 'soft',
  walletBalanceKes: 100,
};

describe('live transfer conference', () => {
  beforeEach(() => resetConferenceTransfersForTests());

  it('builds a safe room name and originate body', () => {
    assert.equal(conferenceRoomName('HD_abc/123'), 'scalers-HD_abc123');
    assert.match(clientRequestIdFor('HD_abc123'), /^xfer-HD_abc123$/);
    const body = buildOriginateBody({
      from: '+254709221536',
      to: '+254712345678',
      voiceCallbackUrl: 'https://voice.test/voice/transfer-agent',
      clientRequestId: 'xfer-HD_abc123',
    });
    assert.deepEqual(body.to, ['+254712345678']);
    assert.equal(body.from, '+254709221536');
    assert.equal(body.voice_callback_url, 'https://voice.test/voice/transfer-agent');
  });

  it('admits the caller on /voice/transfer and not on a completed leg', () => {
    armConferenceTransfer(armed);
    const admit = decideTransferContinue({
      callSid: 'HD_abc123',
      callSessionState: '',
      body: {},
      source: 'transfer_continue',
    });
    assert.equal(conferenceKeepsCallOpen('HD_abc123'), true);
    assert.equal(admit.kind, 'caller_conference');
    assert.equal(admit.document.actions[1].conference.startOnEnter, false);
    assert.equal(admit.document.actions[1].conference.endOnExit, false);
    assert.equal(admit.document.actions[1].conference.name, 'scalers-HD_abc123');

    const late = decideTransferContinue({
      callSid: 'HD_abc123',
      callSessionState: 'Completed',
      body: {},
      source: 'transfer_continue',
    });
    assert.equal(late.kind, 'terminal_drop');
  });

  it('puts the caller in the room at answer and dials only after arm', () => {
    const xml = buildLiveBridgeXml({
      streamUrl: 'wss://voice.test/ws/media?callSid=HD_abc123',
      continueUrl: 'https://voice.test/voice/conference-hold?callSid=HD_abc123',
    });
    assert.match(xml, /connect="false"/);
    assert.doesNotMatch(xml, /connect="true"/);
    assert.match(xml, /voice\/conference-hold\?callSid=HD_abc123/);

    const seeded = seedConferenceHold({
      callSid: 'HD_abc123',
      callerId: '+254709221536',
      callerNumber: '+254715715894',
      eventsUrl: armed.eventsUrl,
      agentUrl: armed.agentUrl,
      fallbackUrl: armed.fallbackUrl,
    });
    assert.equal(seeded.status, 'listening');
    assert.equal(seeded.transferArmed, false);
    const hold = buildHoldConferenceDocument(seeded);
    assert.equal(hold.actions[0].conference.startOnEnter, true);
    assert.equal(hold.actions[0].conference.name, 'scalers-HD_abc123');

    const early = decideConferenceEvent({
      callSid: 'HD_abc123',
      body: { event: 'join', caller: '+254715715894', participant_id: 'p-caller' },
    });
    assert.equal(early.originate, false);

    const updated = armConferenceTransfer(armed);
    assert.equal(updated.transferArmed, true);
    assert.equal(updated.callerJoined, true);
    assert.equal(updated.to, '+254712345678');
  });

  it('originates once when the caller joins, then bridges the agent', async () => {
    armConferenceTransfer(armed);
    decideTransferContinue({
      callSid: 'HD_abc123',
      source: 'transfer_continue',
      body: {},
    });
    const joined = decideConferenceEvent({
      callSid: 'HD_abc123',
      body: {
        event: 'join',
        conference_name: 'scalers-HD_abc123',
        caller: '+254715715894',
        participant_id: 'p-caller',
      },
    });
    assert.equal(joined.action, 'caller_joined');
    assert.equal(joined.originate, true);

    const claimed = claimOriginate('HD_abc123');
    assert.equal(claimed.denied, false);
    const again = decideConferenceEvent({
      callSid: 'HD_abc123',
      body: { event: 'join', caller: '+254715715894' },
    });
    assert.equal(again.originate, false);

    let posted = null;
    const result = await postOutboundTransfer({
      attempt: claimed.attempt,
      apiKey: 'test-key',
      apiBase: 'https://api.test',
      fetchImpl: async (url, init) => {
        posted = { url, init: JSON.parse(init.body), key: init.headers.Authorization };
        return {
          ok: true,
          status: 201,
          json: async () => ({ session_id: 'HD_out1', status: 'ringing' }),
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.outboundCallSid, 'HD_out1');
    assert.equal(posted.url, 'https://api.test/v1/calls');
    assert.deepEqual(posted.init.to, ['+254712345678']);
    assert.equal(posted.key, 'Bearer test-key');

    const bridged = decideConferenceEvent({
      callSid: 'HD_abc123',
      body: { event: 'join', caller: '+254712345678', participant_id: 'p-agent' },
    });
    assert.equal(bridged.action, 'bridged');
    assert.equal(conferenceKeepsCallOpen('HD_abc123'), true);
  });

  it('does not originate when hard billing cannot cover one outbound minute', () => {
    armConferenceTransfer({ ...armed, billingEnforcement: 'hard', walletBalanceKes: 0 });
    const claimed = claimOriginate('HD_abc123');
    assert.equal(claimed.denied, true);
    assert.equal(claimed.reason, 'wallet_too_low');
  });

  it('joins the agent leg to the same room', () => {
    armConferenceTransfer(armed);
    const agent = decideAgentJoin({ callSid: 'HD_abc123' });
    assert.equal(agent.kind, 'agent_conference');
    assert.equal(agent.document.actions[0].conference.startOnEnter, true);
    assert.equal(agent.document.actions[0].conference.endOnExit, true);
    assert.equal(agent.document.actions.length, 1);
  });

  it('treats an unanswered outbound leg as a miss and a bridged hangup as done', () => {
    assert.equal(outboundLegResult({ status: 'no_answer', conferenceStatus: 'dialing' }), 'missed');
    assert.equal(outboundLegResult({ status: 'busy', conferenceStatus: 'dialing' }), 'missed');
    assert.equal(
      outboundLegResult({ status: 'complete', durationSeconds: 0, conferenceStatus: 'dialing' }),
      'missed'
    );
    assert.equal(
      outboundLegResult({ status: 'complete', durationSeconds: 40, conferenceStatus: 'bridged' }),
      'bridged_end'
    );
    assert.match(FALLBACK_SAY, /follow up/);
  });
});
