'use strict';
// BRAIN_V2_REPLY_OWNER: one reply owner + turn acts. Replays HD_94798fc49d25 (10f115ac dial) and HD_babe6cdffdc7.
process.env.BRAIN_V2_FACT_STORE = 'on'; process.env.BRAIN_V2_NLU_GAPS = 'on'; process.env.VOICE_V2_CATALOGUE = 'on'; process.env.BRAIN_V2_CONV_STATE = 'on';
const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../src/conversation/v2');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const NOW = new Date('2026-10-24T07:41:00Z');
// [text, Voice langLock, model fields]
const H94 = [['Nipo.', 'sw'], ['Nilikuwa nataka kukumbuka Carpet Cleaning in', 'sw'],
  ["Yeah, I'd like to book—", 'sw', { asks: ['book'], place: null, service_id: 'svc_4dc611dcf0e74b71' }],
  ['I said tomorrow.', 'en'], ['And if I may ask you, the.', 'en'],
  ['Like, do you like offer Post-Construction Services and by any chance could you tell me what is done about it?', 'en'],
  ['I said like, tell me about the Post-Construction Services you guys offer,', 'en'],
  ['Oh. What else can you tell me about your coverage?', 'en'], ['And how can I pay?', 'en'], ['About the.', 'en'],
  ['Carpet cleaning, right?', 'en'], ["Uh, let's do 11:00", 'en'], ['Uh, Rongai.', 'en'],
  ['Yeah, Ongata Rongai in Kajiado. Is that— is it possible?', 'en'], ['Four?', 'en'],
  ['My name— what have you said my name is?', 'en', { asks: ['possible'], place: 'set', service_id: null }]];
const BABE = [['I was just asking, like, I— I was.'], ['So curious to know how now.'], ['Interior.'],
  ['Window cleaning is done, so.', null, { asks: ['explain'], service_id: 'svc_bf7babf2e7584f74' }],
  ['And by any chance, how much is it?'], ['Like, the interior window cleaning.'],
  ["Oh, and, uh, what's your coverage?"], ["What's your coverage?"], ['Definitely no.']];

async function play(turns, { flag = 'on', contactName = null } = {}) {
  process.env.BRAIN_V2_REPLY_OWNER = flag;
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001', contactName, openRows: [] });
  const lines = []; const langs = [];
  for (const [t, lock, f] of turns) { const r = await V2.runTurn(st, { text: t, langLock: lock || null, profile: DD, now: NOW, handlers: {}, turnFields: f || null }); lines.push(r.line); langs.push(r.lang); }
  return { st, lines, langs };
}

test('HD_94798 T1: "Nipo." (I\'m here) is never bound as the name', async () => {
  const { st, lines } = await play(H94.slice(0, 1));
  assert.ok(!st.slots.name); assert.doesNotMatch(lines[0], /Nipo/);
});
test('HD_94798 T3: the caller switches to English, the reply follows (Voice lock was sw)', async () => {
  const { lines, langs } = await play(H94.slice(0, 3));
  assert.equal(langs[2], 'en'); assert.match(lines[2], /what day/i);
});
test('HD_94798 T6/T7: a mid-booking ask about another service is answered, the booking keeps its service, the time is asked once, no callback', async () => {
  const { st, lines } = await play(H94.slice(0, 7));
  assert.match(lines[5], /building or renovation/i); assert.match(lines[5], /What time on Sunday\?$/);
  assert.match(st.slots.service, /Carpet/);
  assert.doesNotMatch(lines[6], /call you back/);
});
test('HD_94798 T11: "Carpet cleaning, right?" is a check: confirmed, then the open question once', async () => {
  const { st, lines } = await play(H94.slice(0, 11));
  assert.match(lines[10], /^Yes, carpet cleaning\. What time on Sunday\?$/i);
  assert.match(st.slots.service, /Carpet/);
});
test('HD_94798 T14: read-back area is the exact chosen area and "is it possible" is answered', async () => {
  const { st, lines } = await play(H94.slice(0, 14));
  assert.equal(st.slots.place, 'Ongata Rongai');
  assert.match(lines[13], /^Ongata Rongai is on our list of service areas\./);
});
test('HD_94798 T15/T16: "Four?" is not a name; "what have you said my name is?" is answered from state', async () => {
  const { st, lines } = await play(H94);
  assert.notEqual(st.slots.name, 'Four');
  assert.match(lines[15], /don't have your name|have your name as/i);
  assert.doesNotMatch(lines[15], /take your time|shall i book/i);
});
test('name check during the read-back: confirm, correct, read back again with the new name', async () => {
  const { st, lines } = await play([['I want carpet cleaning tomorrow at 11am in Juja'], ['Peter'],
    ['What name did you put for me?'], ['No'], ['Alvin']]);
  const rb = lines.findIndex((l) => /Shall I book it\?/.test(l));
  assert.ok(rb >= 0, lines.join(' | '));
  assert.match(lines[2], /I have your name as Peter\. Is that right\?/);
  assert.match(lines[3], /May I have your name\?/);
  assert.match(lines[4], /for Alvin\. Shall I book it\?/);
  assert.equal(st.slots.name, 'Alvin'); assert.equal(st.pending?.name, 'Alvin');
});
test('a service check that differs offers the switch and changes the service only on yes', async () => {
  const { st, lines } = await play([['I want carpet cleaning tomorrow'], ['Sofa cleaning, right?'], ['No']]);
  assert.match(lines[1], /instead\?$/); assert.match(st.slots.service, /Carpet/);
});
test('the same open question twice with no progress becomes the callback offer', async () => {
  const { st, lines } = await play([['I want carpet cleaning tomorrow'], ['Hmm.'], ['Hmm.'], ['Hmm.']]);
  assert.ok(lines.some((l) => /call you back\?/.test(l)), lines.join(' | '));
  assert.equal(st.offer, 'callback');
});
test('HD_babe replay still passes with the reply owner on', async () => {
  const { lines } = await play(BABE, { contactName: 'Alvin' });
  assert.doesNotMatch(lines[2], /Thanks, Interior/);
  assert.match(lines[4], /200 shillings/);
  assert.match(lines[6], /Kitengela/);
  assert.match(lines[8], /anything else/i);
});
test('flag off: HD_94798 still binds "Nipo" (old behaviour unchanged)', async () => {
  const { st } = await play(H94.slice(0, 1), { flag: 'off', contactName: null });
  assert.equal(st.slots.name, 'Nipo');
});
