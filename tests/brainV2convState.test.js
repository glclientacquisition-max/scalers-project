'use strict';
// Phase 1 conversation state (BRAIN_V2_CONV_STATE). Replay cases from HD_babe6cdffdc7 (24 Oct staging dial).
process.env.BRAIN_V2_FACT_STORE = 'on'; process.env.BRAIN_V2_NLU_GAPS = 'on'; process.env.VOICE_V2_CATALOGUE = 'on';
const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../src/conversation/v2');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const NOW = new Date('2026-10-24T07:06:00Z');
const BABE = [['I was just asking, like, I— I was.'], ['So curious to know how now.'], ['Interior.'],
  ['Window cleaning is done, so.', { asks: ['explain'], service_id: 'svc_bf7babf2e7584f74' }],
  ['And by any chance, how much is it?'], ['Like, the interior window cleaning.'],
  ["Oh, and, uh, what's your coverage?"], ["What's your coverage?"], ['Definitely no.']];

async function play(turns, flag = 'on') {
  process.env.BRAIN_V2_CONV_STATE = flag;
  delete process.env.BRAIN_V2_REPLY_OWNER; // these cases pin #924 alone (no env leak from staging flags)
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001', contactName: 'Alvin', openRows: [] });
  const lines = [];
  for (const [t, f] of turns) lines.push((await V2.runTurn(st, { text: t, profile: DD, now: NOW, handlers: {}, turnFields: f || null })).line);
  return { st, lines };
}

test('A5: "Interior." is a catalogue word, not a name', async () => {
  const { lines } = await play(BABE.slice(0, 3));
  assert.doesNotMatch(lines[2], /Thanks, Interior/);
  assert.match(lines[2], /interior window cleaning/i);
});
test('A2: "how much is it" carries the service forward', async () => {
  const { lines } = await play(BABE.slice(0, 5));
  assert.match(lines[4], /200 shillings/);
});
test('A3: coverage asked twice is answered, no booking re-ask or repair', async () => {
  const { lines } = await play(BABE.slice(0, 8));
  for (const l of lines.slice(6, 8)) { assert.match(l, /Kitengela/); assert.doesNotMatch(l, /didn't catch|which service/i); }
});
test('A4: "Definitely no." is a no, not a place or a repair', async () => {
  const { lines } = await play(BABE);
  assert.doesNotMatch(lines[8], /isn't on our list|didn't catch/);
  assert.match(lines[8], /anything else/i);
});
test('A12: second consecutive repair becomes a callback offer; yes reads back a handoff', async () => {
  const { st, lines } = await play([['Hello.'], ['Blorp flim.'], ['Zxq vrr.'], ['Yes please.']]);
  const i = lines.findIndex((l) => /call you back\?/.test(l));
  assert.ok(i > 0, lines.join(' | '));
  assert.ok(st.pending?.tool === 'create_handoff' || /call/i.test(lines[i + 1] || ''), lines.join(' | '));
});
test('flag off: HD_babe behaviour unchanged (old "Thanks, Interior.")', async () => {
  const { st, lines } = await play(BABE.slice(0, 3), 'off');
  assert.match(lines[2], /Thanks, Interior/);
  assert.ok(!st.conv);
});
