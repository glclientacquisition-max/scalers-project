#!/usr/bin/env node
// Conference live-transfer smoke. No SautiKit PSTN, no wallet debit.

const assert = require('node:assert/strict');
const {
  buildAnswerConferenceHoldXml,
  buildAgentJoinConferenceXml,
  conferenceRoomName,
  queuePendingLiveTransfer,
  consumeLiveTransferWebhook,
  resetPendingLiveTransfersForTests,
} = require('../src/sautikit/pendingLiveTransfer');
const { originateOutboundCall } = require('../src/sautikit/voiceApi');
const { liveTransferReady } = require('../src/conversation/liveTransferReady');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');
const { planTransferLegCharges } = require('../src/billing/liveTransferLegs');

let failed = 0;

function fail(name, err) {
  failed += 1;
  console.error(`FAIL  ${name}: ${err.message || err}`);
}

function pass(name) {
  console.log(`PASS  ${name}`);
}

const profile = {
  handoffMode: 'live_transfer',
  agentTools: { escalate: true, end_call: true },
  hoursSchedule: defaultHoursSchedule(),
  teamDirectory: [{ name: 'Alvin', role: 'Owner', phone: '+254790381872' }],
};

const openTue = new Date('2026-09-07T07:00:00.000Z');

async function main() {
  try {
    const room = conferenceRoomName('HD_smoke1');
    const hold = buildAnswerConferenceHoldXml({
      streamUrl: 'wss://example.test/ws/media?callSid=HD_smoke1',
      room,
    });
    assert.match(hold, /connect="false"/);
    assert.match(hold, /<Conference/);
    assert.doesNotMatch(hold, /connect="true"/);
    pass('inbound answer is Stream without connect plus Conference');
  } catch (err) {
    fail('inbound conference hold XML', err);
  }

  try {
    const xml = buildAgentJoinConferenceXml({ room: 'xfersmoke' });
    assert.match(xml, /<Say>You have a caller on the line\.<\/Say>/);
    assert.match(xml, />xfersmoke<\/Conference>/);
    pass('outbound agent joins the same Conference room');
  } catch (err) {
    fail('agent join XML', err);
  }

  try {
    const off = liveTransferReady({
      profile,
      executorEnabled: false,
      now: openTue,
    });
    assert.equal(off.ready, false);
    assert.equal(off.reason, 'executor_off');
    pass('executor off does not authorize TRANSFER');
  } catch (err) {
    fail('executor off gate', err);
  }

  try {
    const ok = liveTransferReady({
      profile,
      executorEnabled: true,
      now: openTue,
    });
    assert.equal(ok.ready, true);
    pass('executor + live_transfer + open hours + directory phone is ready');
  } catch (err) {
    fail('ready gates', err);
  }

  try {
    const beta = liveTransferReady({
      profile: { ...profile, billingEnforcement: 'off' },
      executorEnabled: true,
      now: openTue,
    });
    assert.equal(beta.ready, false);
    assert.equal(beta.reason, 'beta_no_outbound');
    pass('beta does not originate outbound without the lab flag');
  } catch (err) {
    fail('beta outbound gate', err);
  }

  try {
    resetPendingLiveTransfersForTests();
    queuePendingLiveTransfer({
      callSid: 'HD_smoke1',
      to: '+254790381872',
      callerId: '+254709221536',
      mode: 'conference',
      room: 'xfersmoke',
    });
    const hit = consumeLiveTransferWebhook({
      callSid: 'HD_smoke1',
      callSessionState: 'Completed',
      body: {},
    });
    assert.equal(hit, null);
    pass('conference pending does not return Dial on Completed');
  } catch (err) {
    fail('no Dial on Completed', err);
  } finally {
    resetPendingLiveTransfersForTests();
  }

  const prevKey = process.env.SAUTIKIT_API_KEY;
  try {
    process.env.SAUTIKIT_API_KEY = 'smoke-key';
    let captured = null;
    const result = await originateOutboundCall({
      from: '+254709221536',
      to: '+254790381872',
      voiceCallbackUrl:
        'https://example.test/voice/transfer-agent?inbound=HD_smoke1&room=xfersmoke',
      clientRequestId: 'xfer-HD_smoke1',
      fetchImpl: async (url, opts) => {
        captured = { url, body: JSON.parse(opts.body) };
        return {
          status: 201,
          text: async () => JSON.stringify({ session_id: 'HD_out', status: 'ringing' }),
        };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(captured.body.to, ['+254790381872']);
    assert.match(captured.url, /\/v1\/calls$/);
    pass('originate POSTs /v1/calls with to[] and agent callback');
  } catch (err) {
    fail('originate payload', err);
  } finally {
    if (prevKey == null) delete process.env.SAUTIKIT_API_KEY;
    else process.env.SAUTIKIT_API_KEY = prevKey;
  }

  try {
    delete process.env.SAUTIKIT_API_KEY;
    const result = await originateOutboundCall({
      from: '+254709221536',
      to: '+254790381872',
      voiceCallbackUrl: 'https://example.test/voice/transfer-agent',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_api_key');
    pass('originate fails closed without SAUTIKIT_API_KEY');
  } catch (err) {
    fail('no api key', err);
  } finally {
    if (prevKey == null) delete process.env.SAUTIKIT_API_KEY;
    else process.env.SAUTIKIT_API_KEY = prevKey;
  }

  try {
    const plan = planTransferLegCharges({
      inboundDurationSeconds: 90,
      outboundDurationSeconds: 60,
      outboundStatus: 'complete',
    });
    assert.equal(plan.inbound.rateKesPerMin, 0);
    assert.equal(plan.outbound.rateKesPerMin, 4);
    assert.equal(plan.doNotFoldOutboundIntoInbound, true);
    pass('wallet plan is inbound 0 / outbound 4 on separate rows');
  } catch (err) {
    fail('billing plan', err);
  }

  if (failed) {
    console.error(`\nLive transfer conference smoke failed (${failed}).`);
    process.exit(1);
  }
  console.log('\nLive transfer conference smoke passed (no PSTN).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
