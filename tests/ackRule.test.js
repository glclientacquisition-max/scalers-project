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
test('filler: rate-limited (Mm counts), none on short or question turns, status line on tool turns', () => {
  const long = 'nilikuwa nataka kusafisha godoro langu kesho asubuhi pale nyumbani';
  const t = A.createAckTracker(); t.beginTurn({ callerText: 'hello there my friend' });
  assert.equal(A.pickRuleFiller({ lang: 'sw', tracker: t, callerText: long }), null, 'first turn');
  for (let i = 0; i < 6; i++) t.beginTurn({ callerText: 'x' });
  assert.equal(A.pickRuleFiller({ lang: 'sw', tracker: t, callerText: 'Yeah.' }), null, 'short');
  assert.equal(A.pickRuleFiller({ lang: 'sw', tracker: t, callerText: 'Kisha mtakuja saa ngapi kesho asubuhi?' }), null, 'question');
  assert.equal(A.pickRuleFiller({ lang: 'sw', tracker: t, callerText: 'nataka kusafisha godoro kesho' }), null, 'Mm needs a long turn');
  assert.deepEqual(A.pickRuleFiller({ lang: 'sw', tracker: t, callerText: long }), { text: 'Mm.', word: false });
  const w = A.pickRuleFiller({ lang: 'en', toolTurn: true, tracker: t, callerText: 'Yeah.' });
  assert.equal(w.text, 'Let me check.'); assert.equal(A.isHeardAck(w.text), false, 'status line is not an ack');
  t.noteHeard('Mm.'); assert.equal(t.allowed(), false, 'Mm counts');
  t.beginTurn({ callerText: long });
  assert.equal(A.pickRuleFiller({ lang: 'sw', tracker: t, callerText: long }), null, 'never two in a row');
});
test('backstop: after any filler, drop bare-ack sentence and strip "Asante sana," lead', () => {
  const t = A.createAckTracker(); t.beginTurn(); t.beginTurn(); t.noteHeard('Mm.');
  assert.equal(A.applyAckBackstop('Sawa kabisa.', { tracker: t, acked: true, dropBare: true }), '');
  assert.equal(A.applyAckBackstop('Asante sana, Alvin!', { tracker: t, acked: true }), 'Alvin!');
  assert.equal(A.applyAckBackstop('Sawa kabisa.', { tracker: t, acked: true }), 'Sawa kabisa.');
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
  // Mm is heard as an ack and stacks with an ack-led reply
  const m = A.scoreAckRule([{ text: 'Habari' }, { filler: 'Mm.', text: 'Sawa kabisa.' }, { text: 'Kesho saa tatu.' }, { text: 'Tuje wapi?' }]);
  assert.equal(m.ackLed, 1); assert.equal(m.stacks, 1);
  assert.equal(A.scoreAckRule(Array.from({ length: 10 }, (_, i) => (i === 5 ? { filler: 'Mm.', text: 'Nimeweka.' } : { text: 'Habari' }))).pass, true);
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
// B2: the shadow and the old Gemini turn's word filler (ruleFiller / wordAckTurn) are deleted with the old turn;
// the v2 machine's ack rule (above) and the engines filler own acks on every call now.
test('server (B2): no shadow ack hook and no old-turn word filler left', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /acked: ackTracker\.allowed\(\)/);
  assert.doesNotMatch(src, /wordAckTurn|ruleFiller/);
});

test('staging heard fixtures HD_db0e864043c1 + HD_4ec204aafa93: before >10% with stacks; rule replay 0 stacks, <=1 Voice ack; 4ec2 <=10% incl Mm', () => {
  const fs = require('fs'); const path = require('path');
  const dir = path.join(__dirname, 'fixtures', 'ack-heard');
  const calls = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
  assert.equal(calls.length, 2);
  for (const c of calls) {
    const before = A.scoreAckRule(c.turns.map((t) => ({ filler: t.filler, text: t.reply })));
    const after = A.scoreAckRule(A.replayHeard(c.turns));
    assert.ok(before.ackLedPct > 10, `${c.callId} before ${before.ackLedPct}`);
    assert.ok(before.stacks >= 2, `${c.callId} stacks ${before.stacks}`);
    assert.equal(after.stacks, 0, c.callId);
    const replay = A.replayHeard(c.turns);
    // Voice-made acks: heard-ack fillers, plus ack leads left on a line that followed a filler.
    const voiceAcks = replay.filter((x) => A.isHeardAck(x.filler) || (x.filler && A.isAckLed(x.text))).length;
    assert.ok(voiceAcks <= 1, `${c.callId} voice acks ${voiceAcks}`);
    if (c.callId === 'HD_4ec204aafa93') assert.ok(after.ackLedPct <= 10, `${c.callId} after ${after.ackLedPct}`);
  }
});
