const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/speech/ackRule');
const { trimAckLead } = require('../src/speech/toolHold');
const { pickContextualAck } = require('../src/conversation/dynamicSpeech');

test('flag default off', () => { assert.equal(A.ackRuleEnabled({}), false); assert.equal(A.ackRuleEnabled({ VOICE_ACK_RULE: '1' }), true); });
test('trimAckLead off = old list; on = widened', () => {
  assert.equal(trimAckLead('Haya, nimeweka.', { acked: true, env: {} }), 'Haya, nimeweka.');
  for (const w of ['Haya', 'Asante', 'Sure', 'Poa', 'Ni sawa', 'Sawa sawa', 'Sawa kabisa'])
    assert.equal(trimAckLead(`${w}, nimeweka.`, { acked: true, env: { VOICE_ACK_RULE: '1' } }), 'Nimeweka.');
  assert.equal(trimAckLead('Okay. They will call.', { acked: true, env: {} }), 'They will call.');
  assert.equal(trimAckLead('Haya, nimeweka.', { acked: false, env: { VOICE_ACK_RULE: '1' } }), 'Haya, nimeweka.');
});
test('pickContextualAck: Mm after ack-led or caller sawa; unchanged without ctx', () => {
  assert.equal(pickContextualAck('nataka kubook', 'sw'), 'Sawa.');
  assert.equal(pickContextualAck('nataka kubook', 'sw', { ackRule: true, prevAckLed: true }), 'Mm.');
  assert.equal(pickContextualAck('Sawa', 'sw', { ackRule: true }), 'Mm.');
});
test('tracker: no ack first turn, never two in a row, 1 per 3, caller sawa', () => {
  const t = A.createAckTracker();
  t.beginTurn({ callerText: 'hello' }); assert.equal(t.allowed(), false);
  t.beginTurn({ callerText: 'nataka carpet' }); assert.equal(t.allowed(), true); t.noteHeard('Sawa.'); assert.equal(t.allowed(), false);
  t.beginTurn({ callerText: 'kesho' }); assert.equal(t.allowed(), false);
  t.beginTurn({ callerText: 'saa nne' }); assert.equal(t.allowed(), false);
  t.beginTurn({ callerText: 'sawa' }); assert.equal(t.allowed(), false);
  t.beginTurn({ callerText: 'nifanyie booking' }); assert.equal(t.allowed(), true);
});
test('filler: word ack (<=3 words) only on allowed tool turn', () => {
  const t = A.createAckTracker(); t.beginTurn(); t.beginTurn();
  assert.deepEqual(A.pickRuleFiller({ lang: 'sw', toolTurn: false, tracker: t }), { text: 'Mm.', word: false });
  const w = A.pickRuleFiller({ lang: 'en', toolTurn: true, tracker: t });
  assert.equal(w.word, true); assert.ok(w.text.split(/\s+/).length <= 3);
});
test('backstop: thinking-ack never stacks, closings exempt', () => {
  const t = A.createAckTracker(); t.beginTurn(); t.beginTurn(); t.noteHeard('Sawa.');
  assert.equal(A.applyAckBackstop('Sawa, nimeweka.', { tracker: t, acked: true }), 'Nimeweka.');
  assert.equal(A.applyAckBackstop('Asante kwa kupiga simu. Kwaheri.', { tracker: t, acked: true }), 'Asante kwa kupiga simu. Kwaheri.');
  assert.equal(A.applyAckBackstop('Mm. Ngoja.', { tracker: t, acked: true }), 'Mm. Ngoja.');
});
test('scoreAckRule: pct excl goodbyes, stacks, run', () => {
  const r = A.scoreAckRule([{ text: 'Habari' }, { filler: 'Sawa.', text: 'Sawa, nimeweka.' }, { text: 'Okay. Anything else?' }, { text: 'Asante, kwaheri.' }]);
  assert.equal(r.counted, 3); assert.equal(r.ackLed, 2); assert.equal(r.stacks, 1); assert.equal(r.longestRun, 2); assert.equal(r.pass, false);
  assert.equal(A.scoreAckRule([{ text: 'Habari' }, { filler: 'Mm.', text: 'Nimeweka.' }]).pass, true);
});
test('v2Shadow: acked passed and v2 lead stripped only under rule', async () => {
  const { createBrainV2Shadow } = require('../src/conversation/v2Shadow');
  let seen = null;
  const fake = { createState: () => ({}), createDryRunHandlers: () => ({}),
    async *runTurnStream(_s, o) { seen = o; yield { type: 'tool', phase: 'start', name: 'createAppointment', write: true }; yield { type: 'sentence', text: 'Sawa, nimeweka.', lang: 'sw' }; yield { type: 'done' }; } };
  const sh = createBrainV2Shadow({ loadV2: () => fake, env: { BRAIN_V2_SHADOW: '1' } });
  const on = await sh.fire({ text: 'x', profile: {}, turnIndex: 1, acked: true, ackRule: true, stripAck: A.stripAckLead });
  assert.equal(seen.acked, true); assert.equal(on.v2Text, 'Nimeweka.'); assert.equal(on.voiceAck, 'tool_start');
  const off = await sh.fire({ text: 'x', profile: {}, turnIndex: 2 });
  assert.equal('acked' in seen, false); assert.equal(off.v2Text, 'Sawa, nimeweka.'); assert.equal('voiceAck' in off, false);
});

test('v2Shadow acked: read after the filler delay; true only if a word filler played', async () => {
  const { createBrainV2Shadow } = require('../src/conversation/v2Shadow');
  const seen = [];
  const fake = { createState: () => ({}), createDryRunHandlers: () => ({}),
    async *runTurnStream(_s, o) { seen.push(o.acked); yield { type: 'done' }; } };
  const sh = createBrainV2Shadow({ loadV2: () => fake, env: {}, log: () => {} });
  let played = false; setTimeout(() => { played = true; }, 20);
  await sh.fire({ text: 'x', profile: {}, turnIndex: 1, ackRule: true, acked: () => played, ackWaitMs: 60 });
  await sh.fire({ text: 'y', profile: {}, turnIndex: 2, ackRule: true, acked: () => false, ackWaitMs: 10 });
  assert.deepEqual(seen, [true, false]);
});
test('server: shadow acked is the played word filler, not tracker.allowed()', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /acked: ackTracker\.allowed\(\)/);
  assert.match(src, /acked: \(\) => wordAckTurn === turnTiming/);
  assert.match(src, /if \(ruleFiller && ruleFiller\.word\) wordAckTurn = turnTiming;/);
});
