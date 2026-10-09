// HD_b82fbfef7649 (staging call 5bbb0871, 2026-10-09 20:12 EAT, D&D, build 35d88569).
// 1) Owner got lead + VISIT UPDATED, to both inbox recipients; lead at turn 2
//    titled "missed-call" on an answered call.
// 2) Goodbye did not end the call: second goodbye, idle nudge, STT 408s.
// 3) Duration 193 s (socket) billed over carrier 162 s; every transcript row
//    stamped 20:15:30; stored greeting differed from the spoken one (the spoken
//    line had "You can speak in English or Kiswahili.", now retired for all).
// Run: node --test tests/callFixesB82f.test.js

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'smoke-test-key';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE = require('./fixtures/voice-calls/HD_b82fbfef7649.json');
const {
  detectFarewell,
  farewellGraceMs,
  farewellHangupEnabled,
  isClosingAck,
  planFarewellClose,
} = require('../src/speech/farewell');
const { idleNudgeArmPlan } = require('../src/speech/idleNudge');
const {
  isMediaStalled,
  mediaDurationSeconds,
  mediaStallMs,
} = require('../src/speech/mediaWatch');
const { createCallTranscript } = require('../src/speech/voiceTiming');
const { durationDecision, transcriptInsertRows } = require('../src/db');
const {
  buildOwnerCallMessage,
  clearOwnerCallItems,
  noteOwnerCallItem,
  pendingOwnerCallItems,
} = require('../src/notifications/ownerCallMessage');

const ms = (iso) => Date.parse(iso);
const agentLines = FIXTURE.transcript.filter((t) => t.speaker === 'agent');
const callerLines = FIXTURE.transcript.filter((t) => t.speaker === 'caller');

describe('b82f farewell detection', () => {
  it('finds exactly the two goodbyes in the call', () => {
    const hits = agentLines.filter((t) => detectFarewell(t.text_content).farewell).map((t) => t.text_content);
    assert.deepEqual(hits, ['You are welcome, Alvin. Have a great day!', 'Sawa Alvin, uwe na siku njema!']);
  });

  it('never fires on a mid-call asante, karibu, or a question', () => {
    for (const line of [
      'Asante.',
      'Asante Alvin. Ungependa tusaidie na huduma gani leo?',
      'Niko vyema kabisa, asante kwa kuuliza Alvin. Nawe unaendeleaje, na nikutafutie huduma gani leo?',
      'Karibu!',
      'Thank you, Alvin. I have noted that.',
      'Have a great day! Is there anything else I can help with?',
      'Okay, Sawa.',
      'Naweza kusaidia?',
    ]) {
      assert.equal(detectFarewell(line).farewell, false, line);
    }
  });

  it('covers en / sw / sheng closings', () => {
    for (const line of [
      'Thank you for calling. Goodbye.',
      'Asante. Kwaheri.',
      'Asante kwa kupiga simu, usiku mwema.',
      'Poa, tutaongea.',
      'Take care, Alvin.',
      'Karibu tena!',
    ]) {
      assert.equal(detectFarewell(line).farewell, true, line);
    }
  });

  it('caller "Haya." after the goodbye is an ack, real words are not', () => {
    assert.equal(isClosingAck('Haya.'), true);
    assert.equal(isClosingAck('Okay, thank you. Bye.'), true);
    assert.equal(isClosingAck('Asante sana'), true);
    assert.equal(isClosingAck('Uh, I appreciate it then.'), false);
    assert.equal(isClosingAck('Wait, one more thing'), false);
    assert.equal(isClosingAck('Nataka kubook tena'), false);
  });

  it('replay: hangs up before "Haya." so no second goodbye and no nudge', () => {
    const bye = agentLines.find((t) => t.text_content.startsWith('You are welcome'));
    // ~2.4 s of audio still playing when the line commits.
    const plan = planFarewellClose({ endCallAllowed: FIXTURE.live.agentTools.end_call, playbackRemainingMs: 2400, env: {} });
    assert.equal(plan.mode, 'hangup');
    const hangupAt = ms(bye.at) + plan.delayMs;
    const haya = callerLines.find((t) => t.text_content === 'Haya.');
    assert.ok(hangupAt < ms(haya.at), 'hang-up lands before the caller ack');
    const nudge = agentLines.find((t) => t.text_content === 'Naweza kusaidia?');
    assert.ok(hangupAt < ms(nudge.at));
    // After a goodbye the nudge is never armed.
    assert.equal(
      idleNudgeArmPlan({ event: 'turn_end', heardCaller: true, callEnding: true }).arm,
      false
    );
  });

  it('grace is short and bounded; respect-toggle mode stays quiet then closes', () => {
    assert.equal(farewellGraceMs({}), 1500);
    assert.equal(farewellGraceMs({ VOICE_FAREWELL_GRACE_MS: '99999' }), 5000);
    const quiet = planFarewellClose({
      endCallAllowed: false,
      playbackRemainingMs: 1000,
      env: { VOICE_FAREWELL_RESPECT_END_CALL: 'on' },
    });
    assert.equal(quiet.mode, 'silent');
    assert.equal(quiet.delayMs, 16000);
    const brain = planFarewellClose({ endCallAllowed: false, source: 'brain_end', env: { VOICE_FAREWELL_RESPECT_END_CALL: 'on' } });
    assert.equal(brain.mode, 'hangup');
  });

  it('flag off restores old behaviour', () => {
    assert.equal(farewellHangupEnabled({}), true);
    assert.equal(farewellHangupEnabled({ VOICE_FAREWELL_HANGUP: 'off' }), false);
  });
});

describe('b82f caller gone: media stall', () => {
  it('10 s without caller audio closes; live call frames keep it open', () => {
    assert.equal(mediaStallMs({}), 10000);
    assert.equal(mediaStallMs({ VOICE_MEDIA_STALL_MS: '0' }), 0);
    const last = ms(FIXTURE.live.lastCallerFrameAt);
    assert.equal(isMediaStalled({ lastFrameAt: last, now: last + 9000, stallMs: 10000 }), false);
    assert.equal(isMediaStalled({ lastFrameAt: last, now: last + 10000, stallMs: 10000 }), true);
    // The socket closed 30 s after the last frame; the watchdog closes ~20 s earlier.
    assert.ok(ms(FIXTURE.live.socketClosedAt) - last > 20000);
  });
});

describe('b82f duration', () => {
  const first = ms(FIXTURE.startedAt);
  const last = ms(FIXTURE.live.lastCallerFrameAt);

  it('media fallback is the caller-audio span, not socket lifetime', () => {
    const closed = first + FIXTURE.live.socketLifetimeMs;
    assert.equal(
      mediaDurationSeconds({ firstFrameAt: first, lastFrameAt: last, connectedAt: first, closedAt: closed, env: {} }),
      161
    );
    assert.equal(
      mediaDurationSeconds({
        firstFrameAt: first,
        lastFrameAt: last,
        connectedAt: first,
        closedAt: closed,
        env: { VOICE_DURATION_PREFER_VENDOR: 'off' },
      }),
      193
    );
  });

  it('carrier figure wins in either order; media alone fills', () => {
    // Socket first, carrier later: 193 replaced by 162.
    assert.equal(durationDecision({ existingSeconds: null, nextSeconds: 193, nextSource: 'media' }).accept, true);
    assert.equal(
      durationDecision({ existingSeconds: 193, existingSource: 'media', nextSeconds: 162, nextSource: 'vendor' }).accept,
      true
    );
    // Carrier first: the socket figure cannot raise it.
    assert.equal(
      durationDecision({ existingSeconds: 162, existingSource: 'vendor', nextSeconds: 193, nextSource: 'media' }).accept,
      false
    );
    // A zero carrier figure does not wipe a real one.
    assert.equal(
      durationDecision({ existingSeconds: 161, existingSource: 'media', nextSeconds: 0, nextSource: 'vendor' }).accept,
      false
    );
  });
});

describe('b82f transcript stamps', () => {
  it('each turn carries the time it happened; rows keep turn order', () => {
    let clock = ms('2026-10-09T17:12:20.112Z');
    const log = createCallTranscript({ now: () => clock });
    for (const t of FIXTURE.transcript) {
      clock = ms(t.at);
      if (t.speaker === 'agent') log.pushAgent(t.text_content);
      else log.pushCaller(t.text_content);
    }
    const rows = transcriptInsertRows('call-1', log.turns());
    assert.equal(rows.length, FIXTURE.transcript.length);
    const stamps = rows.map((r) => Date.parse(r.created_at));
    for (let i = 1; i < stamps.length; i += 1) assert.ok(stamps[i] > stamps[i - 1], `row ${i} after ${i - 1}`);
    assert.equal(rows[0].created_at, '2026-10-09T17:12:20.112Z');
    assert.notEqual(rows[rows.length - 1].created_at, FIXTURE.live.transcriptCreatedAt);
  });

  it('same-millisecond turns stay ordered; legacy rows keep the DB default', () => {
    const rows = transcriptInsertRows('c', [
      { speaker: 'caller', text: 'a', at: '2026-10-09T17:00:00.000Z' },
      { speaker: 'agent', text: 'b', at: '2026-10-09T17:00:00.000Z' },
      { speaker: 'agent', text: 'c' },
    ]);
    assert.equal(rows[1].created_at, '2026-10-09T17:00:00.001Z');
    assert.equal('created_at' in rows[2], false);
  });
});

describe('b82f greeting stored as spoken', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  it('the transcript stores the line that was spoken', () => {
    // One greeting variable, built once, in the greeting path.
    assert.equal(/\bgreetingLine\b/.test(src), false);
    assert.equal((src.match(/callTranscript\.pushAgent\(spokenGreeting\)/g) || []).length, 2);
    assert.match(FIXTURE.transcript[0].text_content, /You can speak in English or Kiswahili/);
    assert.doesNotMatch(FIXTURE.live.storedGreeting, /English or Kiswahili/);
  });

  it('the language invite is retired for every business (Alvin, 2026-10-09)', () => {
    const { composeBusinessAssistantIntro } = require('../src/conversation/businessAssistantIntro');
    const line = composeBusinessAssistantIntro({
      businessName: 'Done and Dusted',
      agentName: 'Shy',
      vertical: 'home_services',
      isOpen: false,
      greetingInvite: 'Tukusaidie vipi',
      now: new Date('2026-10-09T17:12:00Z'),
    });
    assert.doesNotMatch(line, /English or Kiswahili/i);
    assert.match(line, /Done and Dusted, this is Shy\./);
  });

  it('the tenant prompt loads once per call even when asked twice', () => {
    const fn = src.slice(src.indexOf('function ensureTenantPrompt()'));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    assert.match(body, /tenantPromptInFlight && tenantPromptInFlightSid === sessionCallSid/);
  });
});

describe('b82f owner message', () => {
  it('one VISIT UPDATED per recipient after the call, named from the call, no missed-call', () => {
    const sid = FIXTURE.callSid;
    clearOwnerCallItems(sid);
    noteOwnerCallItem(sid, { type: 'visit', kind: 'updated', row: FIXTURE.live.updatedVisit });
    const msg = buildOwnerCallMessage({
      call: {
        id: FIXTURE.callId,
        call_sid: sid,
        name: 'Alvin',
        reason: 'Move carpet cleaning visit',
        from_number: '+254700000001',
        status: 'complete',
        summary: JSON.stringify({ first_forward: { greeting_played: true } }),
      },
      items: pendingOwnerCallItems(sid),
      businessName: 'Done and Dusted',
    });
    clearOwnerCallItems(sid);
    assert.equal(msg.kind, 'appointment');
    assert.match(msg.subject, /^VISIT UPDATED/);
    assert.match(msg.body, /Caller: Alvin/);
    assert.doesNotMatch(msg.body, /Caller: like/);
    assert.doesNotMatch(msg.body, /missed-call/i);
    // Live: 4 sends (2 kinds x 2 recipients). Now: 1 kind x 2 recipients.
    const recipients = new Set(FIXTURE.live.notifySends.map((s) => s.recipient));
    assert.equal(recipients.size, 2);
  });
});

describe('b82f server wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  it('a committed goodbye starts the close and the nudge cannot fire after it', () => {
    assert.match(src, /const bye = detectFarewell\(snap\.pendingSpeech\);/);
    assert.match(src, /beginFarewellClose\(\{ line: snap\.pendingSpeech, source: 'phrase' \}\)/);
    assert.match(src, /!callEnding &&\n\s+!farewellClose &&/);
    assert.match(src, /callEnding: callEnding \|\| Boolean\(farewellClose\) \|\| callIsOver\(\)/);
  });

  it('the media close passes the caller-audio span and the carrier figure is final', () => {
    assert.match(src, /durationSource,\n\s+settle: durationSource !== 'media',/);
    assert.match(src, /mediaDurationSeconds\(\{\n\s+firstFrameAt: firstBinaryAt,/);
  });
});
