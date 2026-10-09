// Phase 2 acceptance: HD_015bae4a4af2 (staging, 2026-10-08 12:52 EAT, #609
// tip 1faba375). Alvin: "it sounds off", "it even read punctuations the comma".
//
// These describe the call Phase 2 must produce. They are not part of
// `npm run test:voice`. Voice M0 makes the wire, price, what-else and barge
// checks pass; t9 (services answer kept, one question) and the replay gate
// (no deleted answer) stay red on the legacy mouth.
// Run: npm run test:phase2-acceptance            (legacy mouth)
//      VOICE_STRUCTURED_OUTPUT=on npm run test:phase2-acceptance   (Phase 2 mouth)
// With the flag on, "the mouth" is the structured engine + TTS boundary fed a
// structured reply whose say[] is the recorded Gemini text (a labelled mock).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const EventEmitter = require('events');

const FIXTURE = require('../fixtures/voice-calls/HD_015bae4a4af2.json');
const { polishSpokenDetail } = require('../../src/conversation/dynamicSpeech');
const { profileFromSnapshot } = require('../../src/conversation/promptFacts');
const DUSTED = profileFromSnapshot(require('../fixtures/tenants/done-and-dusted-staging.json'));

function turn(n) {
  return FIXTURE.turns[n - 1];
}

const STRUCTURED = require('../../src/speech/structured/flag').structuredOutputEnabled();

async function mouth(text, callerTurns, language = 'en') {
  const state = {
    language: { current: language },
    goal: { missingSlots: [] },
    caller: { name: 'Alvin', nameConfirmed: true },
    conversation: { answersReceived: callerTurns.slice() },
  };
  if (STRUCTURED) {
    const { runStructuredTurn } = require('../../src/speech/structured/turn');
    const { buildFactTable } = require('../../src/speech/structured/facts');
    const { mockStructuredReply } = require('../../src/speech/structured/mockLabel');
    const { chunksFromJson, streamOf } = require('../../src/speech/structured/mockStream');
    const { prepareStructuredPiece } = require('../../src/speech/structured/speechBoundary');
    const table = buildFactTable(DUSTED, { state, speakerBound: true });
    const value = mockStructuredReply(text, { table, locked: language });
    const result = await runStructuredTurn({
      openStream: async () => streamOf(chunksFromJson(value)),
      locked: language,
      table,
      callerText: callerTurns.join(' '),
      state,
      nameConfirmed: true,
    });
    // What the caller hears, with the sentence marks kept for the checks below.
    return result.spoken
      .map((row) => (prepareStructuredPiece(row.text, { language }).text ? row.text : ''))
      .filter(Boolean)
      .join(' ');
  }
  return polishSpokenDetail(text, {
    profile: DUSTED,
    state,
    language,
    callerTurns,
  }).text;
}

// Soniox joins the pieces of one stream as sent. Capture what it would hear.
class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open');
    });
  }
  send(data) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }
  close() {
    this.readyState = 3;
    this.emit('close', 1000, Buffer.from(''));
  }
}
FakeWebSocket.OPEN = 1;

async function heardByTts(pieces) {
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'ws') return FakeWebSocket;
    return originalLoad(request, parent, isMain);
  };
  process.env.SONIOX_API_KEY = process.env.SONIOX_API_KEY || 'test-key';
  try {
    delete require.cache[require.resolve('../../src/speech/sonioxTts')];
    const { createSonioxTtsSession } = require('../../src/speech/sonioxTts');
    const session = createSonioxTtsSession({ callSid: 'phase2-acceptance', onAudio: () => {} });
    await session.ready;
    const stream = await session.beginSpeak({ language: 'en' });
    for (const piece of pieces) stream.pushText(piece);
    const sent = FakeWebSocket.last.sent.filter(
      (m) => m.stream_id === stream.streamId && m.text_end === false && typeof m.text === 'string'
    );
    stream.cancel();
    session.close();
    return sent.map((m) => m.text);
  } finally {
    Module._load = originalLoad;
  }
}

describe('HD_015b: what Soniox hears', () => {
  it('t2: three sentences in one stream keep a word gap (no "laInterior", "windowWhat")', async () => {
    const sentences = turn(2).model.outputText.match(/[^.!?]+[.!?]/g).map((s) => s.trim());
    const wire = await heardByTts(sentences);
    for (const piece of wire) assert.match(piece, /[\p{L}\p{N}]/u);
    assert.doesNotMatch(wire.join(''), /[a-z][A-Z]/, `glued: ${JSON.stringify(wire.join(''))}`);
  });

  it('never sends a piece without a letter or digit', async () => {
    const wire = await heardByTts(['Sure.', ',', ' - ', 'What day works?']);
    assert.equal(wire.length, 2);
  });
});

describe('HD_015b: the answer the caller asked for is spoken', () => {
  it('t5: the grounded price "6,000" survives the mouth', async () => {
    const out = await mouth(turn(5).model.outputText, [turn(5).caller]);
    assert.match(out, /6,000|six thousand/i, `price deleted: ${JSON.stringify(out)}`);
  });

  it('t8: "What else can you do?" is a services ask, not a read of the visit file', () => {
    const { looksLikeVisitReviewMore } = require('../../src/conversation/openLineSpeech');
    const { looksLikeOfferAsk } = require('../../src/conversation/fileRead');
    assert.equal(looksLikeVisitReviewMore(turn(8).caller), false);
    assert.equal(looksLikeVisitReviewMore('And what else can you do?'), false);
    assert.equal(looksLikeOfferAsk(turn(8).caller), true);
  });

  it('t9: the services answer is kept and the reply asks one question', async () => {
    const out = await mouth(turn(9).model.outputText, [turn(8).caller, turn(9).caller]);
    assert.match(out, /sofa|carpet|mattress|office/i, `services answer deleted: ${JSON.stringify(out)}`);
    assert.ok((out.match(/\?/g) || []).length <= 1, `stacked questions: ${JSON.stringify(out)}`);
  });
});

describe('HD_015b: turn taking', () => {
  it('t6: a final after a barge-in is the next turn, not a thinking continuation', () => {
    const turnTaking = require('../../src/speech/turnTaking');
    assert.equal(typeof turnTaking.bargePhaseInputs, 'function', 'no barge phase rule');
    const phase = turnTaking.bargePhaseInputs({ speaking: false, turnBusy: true, bargeInActive: true, isFinal: true });
    const decision = turnTaking.decideCallerEvent({
      text: 'How much is it?',
      lastAgentText: 'Mm-hmm.',
      lastAgentAskedQuestion: false,
      replayText: '',
      now: Date.now(),
      ...phase,
    });
    assert.equal(decision.action, 'process_turn');
  });
});

describe('HD_015b: replay gate', () => {
  it('replays with no deleted answer and every reply in the caller language', async () => {
    const { replayCall } = require('../../src/speech/replayVoice');
    const { scoreFixtureReplay } = require('../../src/speech/voiceScore');
    const call = await replayCall(FIXTURE, STRUCTURED ? { mouth: 'structured' } : {});
    const scored = scoreFixtureReplay(call, FIXTURE);
    for (const row of call.turns.filter((r) => r.recordKind === 'turn')) {
      for (const tts of (row.stages || []).filter((s) => s.stage === 'tts')) {
        assert.equal(tts.language || 'en', 'en', `turn ${row.turnIndex} switched language`);
      }
    }
    assert.equal(scored.checks.deletedAnswer, 0, `deletedAnswer=${scored.checks.deletedAnswer}`);
  });
});
