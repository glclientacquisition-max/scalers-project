'use strict';
// Retire-old-brain V1 (Voice): the old-brain speech paths are gone from Voice; the engines path is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('/ws/relay is gone: no upgrade branch, no ConversationRelay server, an upgrade there gets the 404', () => {
  assert.doesNotMatch(SERVER, /ws\/relay|wss\.on\('connection'|wss\.handleUpgrade/);
  assert.match(SERVER, /if \(pathname === '\/ws\/media'\)/);
  assert.match(SERVER, /rejecting unknown path \$\{pathname\}`\);\n\s+socket\.write\('HTTP\/1\.1 404 Not Found/);
});

test('no old Gemini turn or per-call system prompt is left in server.js', () => {
  for (const gone of ['runGeminiTurn', 'buildSystemPrompt', 'voiceGeminiConfig', 'geminiVoiceConfig', 'spokenFromLookupTool', 'generateGeminiText', 'applyToolsWithHold', 'safeApplyGeminiTools', 'AI_FALLBACK_LINE', 'getGeminiClient', "require('@google/genai')"]) {
    assert.ok(!SERVER.includes(gone), gone);
  }
  // applyGeminiTools stays: the owned v2 turn writes through it (Brain phase 2 renames it)
  assert.match(SERVER, /applyTools: \(parsed\) => applyGeminiTools\(callKey, parsed, \{ v2Owned: true \}\)/);
});

test('dead per-turn leftovers are gone (filler timer, hold fill, owed-outcome preface, slot rows, arbiter)', () => {
  for (const gone of ['clearFillerTimer', 'holdFillTimer', 'stopHoldFill', 'owedReceiptForFold', 'slotsBeforeReply', 'speechHold', 'progressAlreadySpoken', 'turnArbiter', 'v1Filler', 'onV1Sentence']) {
    assert.ok(!SERVER.includes(gone), gone);
  }
});

test('the call-start spoken-catalogue pin is unconditional (was behind VOICE_TURN_ARBITER, on in staging and prod)', () => {
  const at = SERVER.indexOf('const pin = pinSpokenCatalogue(profile);');
  assert.ok(at > 0);
  assert.doesNotMatch(SERVER.slice(at - 400, at), /if \(/);
});

test('voiceTrace has no shadow diff hook; the engines model stage hook stays', () => {
  const { createVoiceTrace } = require('../src/speech/voiceTrace');
  const on = createVoiceTrace({ enabled: true, sink: { write: async () => {}, update: async () => {} }, callId: 'HD_v1', tenantId: null });
  assert.equal(on.noteBrainV2Shadow, undefined);
  assert.equal(typeof on.noteBrainV2Model, 'function');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src/speech/voiceTrace.js'), 'utf8'), /v2Shadow/);
});

test('grace queue: on by default, VOICE_GRACE_QUEUE=off drops, BRAIN_MODEL_LEAD not read', () => {
  const TT = require('../src/speech/turnTaking');
  const prev = { g: process.env.VOICE_GRACE_QUEUE, m: process.env.BRAIN_MODEL_LEAD };
  const at = { phase: 'speaking', speakStartedAt: 1000, now: 1100, isFinal: true, text: 'Do you come to Rongai?' };
  try {
    delete process.env.VOICE_GRACE_QUEUE; delete process.env.BRAIN_MODEL_LEAD;
    assert.equal(TT.decideCallerEvent(at).reason, 'grace_queued');
    process.env.BRAIN_MODEL_LEAD = 'off';
    assert.equal(TT.decideCallerEvent(at).reason, 'grace_queued');
    process.env.VOICE_GRACE_QUEUE = 'off';
    assert.equal(TT.decideCallerEvent(at).reason, 'grace');
  } finally {
    if (prev.g === undefined) delete process.env.VOICE_GRACE_QUEUE; else process.env.VOICE_GRACE_QUEUE = prev.g;
    if (prev.m === undefined) delete process.env.BRAIN_MODEL_LEAD; else process.env.BRAIN_MODEL_LEAD = prev.m;
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src/speech/turnTaking.js'), 'utf8'), /env\.BRAIN_MODEL_LEAD|'BRAIN_MODEL_LEAD'/);
});

test('sttContext: no liveKnowledge import; catalogue names unchanged (array, JSON string, bad input, empty names)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/speech/sttContext.js'), 'utf8');
  assert.doesNotMatch(src, /require\([^)]*liveKnowledge/);
  const { buildSttContext } = require('../src/speech/sttContext');
  const { normalizeServices } = require('../src/conversation/liveKnowledge');
  for (const raw of [[{ name: ' Carpet ' }, { name: '' }, null, { name: 'Window cleaning', price_range: 'KES 500' }], '[{"name":"Sofa"}]', 'not json', null]) {
    const want = normalizeServices(raw).map((s) => s.name);
    const terms = (buildSttContext({ servicesCatalog: raw }) || { terms: [] }).terms || [];
    for (const n of want) assert.ok(terms.includes(n), `${n} in STT terms`);
  }
});

test('replay: live mode needs an injected responder (the old Gemini prompt default is gone); recorded mode unchanged', async () => {
  const R = require('../src/speech/replayVoice');
  assert.equal(R.liveGeminiText, undefined);
  await assert.rejects(R.replayCall({ callId: 'HD_x', turns: [{ caller: 'hello' }] }, { mode: 'live' }), /needs opts\.respond/);
  const ok = await R.replayCall({ callId: 'HD_x', turns: [{ caller: 'hello' }] }, { mode: 'live', respond: async () => ({ outputText: 'Hello, how can I help?', model: 'stub' }) });
  assert.equal(ok.turns.length, 1);
  const src = fs.readFileSync(path.join(ROOT, 'src/speech/replayVoice.js'), 'utf8');
  assert.doesNotMatch(src, /require\('\.\.\/prompts'\)|geminiVoice/);
});

test('VOICE_FILLER is gone (no reader); the engines stand-down is the only turn filler', () => {
  assert.equal(require('../src/conversation/language').pickFillerText, undefined);
  assert.match(SERVER, /const enginesFiller = createEnginesFillerTurn\(\{/);
});
