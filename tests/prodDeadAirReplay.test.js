// Replay of prod call HD_d3900cbf2b2d (Aris, 2026-10-09 20:18 EAT) against
// every fix on voice/prod-greeting-dead-air. Timeline:
// tests/fixtures/prod-dead-air/HD_d3900cbf2b2d.timeline.json.

// These tests pin the feature itself; the flags-off suite run covers the rest.
process.env.VOICE_SPOKEN_ADDRESS = 'on';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const T = require('./fixtures/prod-dead-air/HD_d3900cbf2b2d.timeline.json');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const {
  createInitialBurstGate,
  prerollFilter,
  pcmBytesToMs,
} = require('../src/speech/greetingPreroll');
const { decideTurnEnd, adaptiveFlushMs, utteranceLooksIncomplete } = require('../src/speech/turnTaking');
const { callerTurnStillOpen } = require('../src/conversation/entityExtraction');
const { cutNoAiSlop } = require('../src/speech/noAiSlop');
const { prepareForTts } = require('../src/speech/ttsNormalize');
const { planHoldTiming, toolStillRunningAfter } = require('../src/speech/toolHold');
const { buildNotifyOutcome } = require('../src/notifications/notifyOutcome');
const { createInboundDirectory } = require('../src/sautikit/inboundDirectory');
const { completedIsCallSetup } = require('../src/sautikit/inboundCalls');

describe('HD_d3900cbf2b2d: greeting cut by audio from before the greeting', () => {
  const burstMs = pcmBytesToMs(T.media.firstFrameBytes);

  it('the 39,040-byte first frame is 1.22 s of queued audio and is drained', () => {
    assert.equal(burstMs, 1220);
    let t = 0;
    const gate = createInitialBurstGate({ enabled: true, now: () => t });
    assert.equal(gate.admit(T.media.firstFrameBytes).forward, false);
    t = 20;
    assert.equal(gate.admit(T.media.normalFrameBytes).forward, true);
    assert.equal(gate.drainedMs, 1220);
  });

  // Every word through "scam y" (720-2100 ms) predates the greeting (2330 ms).
  // The trailing "ou." (2820 ms) is after it, and alone it is too short to
  // barge (prod logged turn_end too_short for it).
  const before = T.turn1Stt.filter((stt) => stt.tokens.every((tok) => tok.startMs < T.media.greetingStartSttMs));

  it('every interim that barged started before the greeting (old STT clock)', () => {
    assert.ok(before.length >= 10);
    assert.ok(before.some((stt) => stt.text === 'And') && before.some((stt) => stt.text === "I'm"));
    const prerollMs = T.media.greetingStartSttMs; // drain off: old clock
    for (const stt of before) {
      const r = prerollFilter(stt.tokens, { prerollMs, greetingPlaying: true, enabled: true });
      assert.equal(r.applied, true, stt.text);
      assert.equal(r.preroll, true, `${stt.text} must not barge the greeting`);
    }
  });

  it('with the burst drained the remaining words still predate the greeting', () => {
    const prerollMs = T.media.greetingStartSttMs - burstMs; // new clock
    for (const stt of before) {
      const shifted = stt.tokens
        .map((tok) => ({ ...tok, startMs: tok.startMs - burstMs }))
        .filter((tok) => tok.startMs >= 0); // drained audio is never transcribed
      if (!shifted.length) continue;
      const r = prerollFilter(shifted, { prerollMs, greetingPlaying: true, enabled: true });
      assert.equal(r.preroll, true, stt.text);
    }
  });

  it('a real barge after the greeting starts still passes', () => {
    const r = prerollFilter(
      [
        { text: 'Wait', startMs: T.media.greetingStartSttMs + 900 },
        { text: ' stop', startMs: T.media.greetingStartSttMs + 1100 },
      ],
      { prerollMs: T.media.greetingStartSttMs, greetingPlaying: true, enabled: true }
    );
    assert.equal(r.preroll, false);
    assert.equal(r.text, 'Wait stop');
  });

  it('server drains the burst and skips preroll barge, then queues the words', () => {
    assert.match(SERVER, /inboundBurstGate\.admit\(buf\.length/);
    assert.match(SERVER, /initial caller audio burst drained/);
    const at = SERVER.indexOf('const preroll = prerollFilter(evt.tokens');
    assert.ok(at > 0);
    const block = SERVER.slice(at, at + 2400);
    assert.match(block, /if \(preroll\.preroll\) return;/);
    assert.match(block, /reason: 'greeting_preroll'/);
  });
});

describe('HD_d3900cbf2b2d: complete question held 2.4 s', () => {
  it('"Uh, what do you guys deal with?" ends the turn without the unfinished hold', () => {
    const text = T.turn3.text;
    assert.equal(T.turn3.observedWaitMs, 2405);
    assert.equal(utteranceLooksIncomplete(text), false);
    assert.equal(callerTurnStillOpen(text), false);
    const d = decideTurnEnd({ text, waitedMs: 0 });
    assert.notEqual(d.reason, 'unfinished');
    assert.ok(d.waitMs <= 360, `wait ${d.waitMs}`);
    assert.ok(adaptiveFlushMs({ text }) <= 360);
  });

  it('a real fragment still waits', () => {
    assert.equal(utteranceLooksIncomplete('Uh, how much for'), true);
    assert.equal(decideTurnEnd({ text: 'I want to book and', waitedMs: 0 }).reason, 'unfinished');
    assert.equal(decideTurnEnd({ text: 'Can I pay with?', waitedMs: 0 }).reason, 'unfinished');
  });
});

describe('HD_d3900cbf2b2d: website read as three sentences', () => {
  it('speaks the address the way a caller writes it down', () => {
    const cut = cutNoAiSlop(T.turn4Model.outputText);
    assert.match(cut, /arisstationaries\.co\.ke\./);
    assert.doesNotMatch(cut, /arisstationaries\. co\. ke/);
    const spoken = prepareForTts(cut, {
      addressTerms: [T.turn4Model.businessName, T.turn4Model.spokenName],
    }).text;
    assert.match(spoken, /aris stationaries dot co dot ke\./);
  });
});

describe('HD_d3900cbf2b2d: 2.1 s of silence while a tool wrote', () => {
  it('the ack was recent, so the hold is deferred, not skipped', () => {
    const ackAt = Date.parse(T.turn5Tool.thinkingAckAt);
    const toolAt = Date.parse(T.turn5Tool.toolStartAt);
    const plan = planHoldTiming({ kind: 'hold', ackAtMs: ackAt, nowMs: toolAt, deferred: true, slowMs: 700 });
    assert.equal(plan.mode, 'defer');
    const old = planHoldTiming({ kind: 'hold', ackAtMs: ackAt, nowMs: toolAt, deferred: false });
    assert.equal(old.mode, 'skip', 'flag off keeps the old skip');
  });

  it('a tool slower than the threshold gets the hold (scaled 1:10)', async () => {
    const toolMs = Date.parse(T.turn5Tool.toolWriteDoneAt) - Date.parse(T.turn5Tool.toolStartAt);
    assert.equal(toolMs, 710);
    const tool = new Promise((r) => setTimeout(r, Math.round(toolMs / 10) + 30));
    assert.equal(await toolStillRunningAfter(tool, 70), true);
  });
});

describe('HD_d3900cbf2b2d: whatsapp_sent:true when WhatsApp failed', () => {
  it('records the real per-channel outcome', () => {
    const outcome = buildNotifyOutcome([{ channel: 'email', errors: T.notify.attempts }]);
    assert.equal(outcome.owner_notified, true);
    assert.equal(outcome.whatsapp_delivered, false);
    assert.deepEqual(outcome.owner_notify_channels, { sms: 'failed', whatsapp: 'failed', email: 'sent' });
  });
});

describe('HD_d3900cbf2b2d: webhook and hangup', () => {
  it('the Ringing webhook answers from the cached directory with no read on the path', async () => {
    let loads = 0;
    const dir = createInboundDirectory({
      loadTenants: async () => {
        loads += 1;
        return {
          rows: [{ id: 't-aris', sautikit_virtual_number: '+254700000009', is_active: true, minutes_included: 0, seconds_used: 0 }],
          packageColumns: true,
        };
      },
    });
    await dir.refresh();
    const r = await dir.lookup({ fromNumber: '+254711000000', toNumber: '+254700000009' });
    assert.equal(loads, 1, 'boot warm only');
    assert.equal(r.tenantId, 't-aris');
    assert.equal(r.gate.open, true);
    assert.equal(T.webhook.sequentialSupabaseReads, 6);
  });

  it('the hangup Completed is terminal once Stream went out', () => {
    assert.equal(
      completedIsCallSetup({ state: 'Completed', hasCallSetupFields: true, streamIssued: true }),
      false
    );
    assert.equal(
      completedIsCallSetup({ state: 'Completed', hasCallSetupFields: true, streamIssued: false }),
      true
    );
  });

  it('the hangup on / and the media close both fetch the recording', () => {
    const lifecycle = SERVER.indexOf("lifecycle edge — empty <Response/> (no re-Stream)");
    const before = SERVER.slice(lifecycle - 1400, lifecycle);
    assert.match(before, /scheduleRecordingFetch\(resolveAttachCallSids\(req\.body, \[sid\]\), 'voice\/incoming'\)/);
    assert.match(SERVER, /scheduleRecordingFetch\(\s*\[sessionCallSid, providerCallIdBySid\.get\(sessionCallSid\)\],\s*'ws\/media'\s*\)/);
  });
});
