// Voice M0 replay locks for HD_015bae4a4af2 (staging, 2026-10-08 12:52 EAT).
// Alvin: "it sounds off", "it even read punctuations the comma".
// One check per M0 fix, each read from the recorded call. Part of test:voice.
// Run: node --test tests/hd015bM0Replay.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');
const EventEmitter = require('events');

const FIXTURE = require('./fixtures/voice-calls/HD_015bae4a4af2.json');
const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot, checkPromptFacts } = require('../src/conversation/promptFacts');
const { buildSystemPrompt } = require('../src/prompts');
const { buildSttContext } = require('../src/speech/sttContext');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const { spaceSpokenWords } = require('../src/conversation/callCorrectives');
const { softenCataloguePunctuation } = require('../src/speech/catalogueMouth');
const { looksLikeOfferAsk } = require('../src/conversation/fileRead');
const { looksLikeVisitReviewMore } = require('../src/conversation/openLineSpeech');
const { bargePhaseInputs, decideCallerEvent } = require('../src/speech/turnTaking');

const DUSTED = profileFromSnapshot(TENANT);
const turn = (n) => FIXTURE.turns[n - 1];

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

async function wirePieces(pieces) {
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'ws') return FakeWebSocket;
    return originalLoad(request, parent, isMain);
  };
  process.env.SONIOX_API_KEY = process.env.SONIOX_API_KEY || 'test-key';
  try {
    delete require.cache[require.resolve('../src/speech/sonioxTts')];
    const { createSonioxTtsSession } = require('../src/speech/sonioxTts');
    const session = createSonioxTtsSession({ callSid: 'hd015b-m0', onAudio: () => {} });
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

describe('S1: coverage is in the prompt and in the hearing context', () => {
  it('the live prompt carries every coverage town and the confirmed payment policy', () => {
    const prompt = buildSystemPrompt(DUSTED);
    for (const town of ['Kitengela', 'Juja', 'Syokimau', 'Ongata Rongai']) {
      assert.match(prompt, new RegExp(town), `prompt lacks ${town}`);
    }
    assert.deepEqual(checkPromptFacts(DUSTED, prompt).missing, []);
  });

  it('t1 heard "Kitengele": the STT snapshot carries coverage towns to Soniox', () => {
    assert.match(turn(1).caller, /Kitengele/);
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const snapshot = server.slice(server.indexOf('sttTenantSnapshot = {'));
    assert.match(snapshot.slice(0, 1200), /businessPolicies: profile\.businessPolicies/);
    const ctx = buildSttContext({
      businessName: DUSTED.businessName,
      agentName: DUSTED.agentName,
      servicesCatalog: DUSTED.servicesCatalog,
      businessLocations: DUSTED.businessLocations,
      businessPolicies: DUSTED.businessPolicies,
      teamDirectory: DUSTED.teamDirectory,
      ttsLexicon: DUSTED.ttsLexicon,
    });
    for (const town of ['Kitengela', 'Nairobi', 'Kiambu', 'Juja', 'Ongata Rongai', 'Syokimau']) {
      assert.ok(ctx.terms.includes(town), `STT context lacks ${town}`);
    }
  });
});

describe('S2: the Soniox wire', () => {
  it('t2: three sentences in one stream keep a word gap', async () => {
    const sentences = turn(2).model.outputText.match(/[^.!?]+[.!?]/g).map((s) => s.trim());
    const wire = await wirePieces(sentences);
    assert.equal(wire.length, 3);
    assert.doesNotMatch(wire[0], /^\s/);
    for (const piece of wire.slice(1)) assert.match(piece, /^ \S/);
    const heard = wire.join('');
    assert.doesNotMatch(heard, /laInterior|windowWhat|[a-z][A-Z]/, `glued: ${JSON.stringify(heard)}`);
  });

  it('t2 and t9 keep sentence punctuation on the wire (listen fixture)', async () => {
    // HD_72ab69cbab2b: the stripped wire was one run-on with no question rise.
    const listen = require('./fixtures/hd015b-tts-wire-listen.json');
    const t2 = turn(2).model.outputText.match(/[^.!?]+[.!?]/g).map((s) => s.trim());
    const wire = await wirePieces(t2);
    const fixtureT2 = listen.cases.find((c) => c.id === 'hd015b-t2');
    assert.deepEqual(wire.map((piece) => piece.trim()), fixtureT2.pieces);
    assert.equal(wire.join(''), fixtureT2.text);
    for (const c of listen.cases) {
      for (const piece of c.pieces) assert.match(piece, /[.?]$/, `${c.id}: ${piece}`);
      assert.doesNotMatch(c.text, /[!;:…—–]/, c.id);
    }
  });

  it('a letterless piece is never sent', async () => {
    const wire = await wirePieces(['Sure.', ',', ' - ', '...', 'What day works?']);
    assert.deepEqual(wire.length, 2);
    for (const piece of wire) assert.match(piece, /[\p{L}\p{N}]/u);
  });
});

describe('S3: price, what else, barge-in', () => {
  it('t5: the grounded "6,000" survives the mouth', () => {
    const state = {
      language: { current: 'en' },
      goal: { missingSlots: [] },
      caller: { name: 'Alvin', nameConfirmed: true },
      conversation: { answersReceived: [turn(5).caller] },
    };
    const out = polishSpokenDetail(turn(5).model.outputText, {
      profile: DUSTED,
      state,
      language: 'en',
      callerTurns: [turn(5).caller],
    }).text;
    assert.match(out, /6,000/, `price deleted: ${JSON.stringify(out)}`);
  });

  it('comma spacing keeps thousands separators and still spaces a glued pause', () => {
    assert.equal(spaceSpokenWords('It is KSh 6,000 flat,and 1,500 sq ft.'), 'It is KSh 6,000 flat, and 1,500 sq ft.');
    assert.equal(softenCataloguePunctuation('Sofa,carpet, KSh 15,000'), 'Sofa, carpet, KSh 15,000');
  });

  it('t8: "What else can you do?" is a services ask, not a visit-file page', () => {
    assert.equal(looksLikeVisitReviewMore(turn(8).caller), false);
    assert.equal(looksLikeOfferAsk(turn(8).caller), true);
    assert.equal(looksLikeVisitReviewMore('And what else can you do?'), false);
    // The caller's own file still pages.
    assert.equal(looksLikeVisitReviewMore('What else do I have?'), true);
    assert.equal(looksLikeVisitReviewMore('show me more'), true);
  });

  it('t7: "How much is it?" after a barge-in is the next turn', () => {
    const base = {
      text: turn(7).caller,
      lastAgentText: 'Mm-hmm.',
      lastAgentAskedQuestion: false,
      replayText: '',
      now: Date.now(),
    };
    const live = { speaking: false, turnBusy: true };
    assert.equal(decideCallerEvent({ ...base, ...live }).reason, 'thinking_continuation');
    const phase = bargePhaseInputs({ ...live, bargeInActive: true, isFinal: true });
    assert.equal(decideCallerEvent({ ...base, ...phase }).action, 'process_turn');
  });

  it('interims and finals without a barge keep the live phase', () => {
    assert.deepEqual(
      bargePhaseInputs({ speaking: true, turnBusy: true, bargeInActive: true, isFinal: false }),
      { speaking: true, turnBusy: true }
    );
    assert.deepEqual(
      bargePhaseInputs({ speaking: false, turnBusy: true, bargeInActive: false, isFinal: true }),
      { speaking: false, turnBusy: true }
    );
  });
});
