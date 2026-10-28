'use strict';
// BRAIN_V2_NLU_GAPS §6a on the Voice path: HD_69f53a46339b T2 names a service, a date and a place, so it is a
// booking step, never the catalogue list (staging spoke the local_catalogue packet).
const { test } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const FX = require('./fixtures/booking/HD_69f53a46339b-T2.json');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const { bookOutranksListTurn } = require('../src/conversation/turnProposals');
const withGaps = async (v, fn) => { const o = process.env.BRAIN_V2_NLU_GAPS; if (v == null) delete process.env.BRAIN_V2_NLU_GAPS; else process.env.BRAIN_V2_NLU_GAPS = v; try { return await fn(); } finally { if (o === undefined) delete process.env.BRAIN_V2_NLU_GAPS; else process.env.BRAIN_V2_NLU_GAPS = o; } };
const now = new Date(FX.now);

test('gaps on: the catalogue yields and v2 takes the booking step', () => withGaps('1', async () => {
  assert.strictEqual(bookOutranksListTurn(FX.caller, DD, { now }), FX.expectWithGaps.catalogueYields);
  const V2 = require('../src/conversation/v2');
  assert.strictEqual(V2.nlu.understand(FX.caller, { profile: DD, now }).kind, FX.expectWithGaps.nluKind);
  const st = V2.createState({ profile: DD }); const lines = [];
  for await (const ev of V2.runTurnStream(st, { text: FX.caller, profile: DD, now, handlers: {}, model: null })) if (ev.text) lines.push(ev.text);
  const said = lines.join(' ');
  assert.ok(said.length > 0);
  for (const bad of FX.expectWithGaps.mustNotSay) assert.ok(!said.includes(bad), `said: ${said}`);
  assert.match(said, /book|name|time|what time|saa|tomorrow|kesho|confirm/i, `booking step expected, said: ${said}`);
  assert.doesNotMatch(said, /\bsofas?, carpets\b/i);
}));

test('gaps off: unchanged (no yield)', () => withGaps(null, () => {
  assert.strictEqual(bookOutranksListTurn(FX.caller, DD, { now }), FX.expectWithoutGaps.catalogueYields);
}));

test('a plain services question still lists, gaps on', () => withGaps('1', () => {
  assert.strictEqual(bookOutranksListTurn('Which service do you offer?', DD, { now }), false);
  assert.strictEqual(bookOutranksListTurn('Mnafanya services gani?', DD, { now }), false);
}));

// B2: the catalogue mouths lived in the old /ws/media Gemini turn, deleted with it (v2 / the engines own the turn).
test('server wiring (B2): the old turn\'s catalogue mouths are gone from server.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /const bookOutranksList = bookOutranksListTurn\(clean, brainProfile\);/);
  for (const re of [/localReply: turnLocalReply,\n\s*legacyMouth: turnLegacyMouth,\n\s*v2Mouth: turnCatalogueMouth,/, /\.concat\(turnCatalogueMouth\.v2Proposals \|\| \[\]\)/, /commitTurnFacts\(speakCommit, \{\n\s*localReply: turnLocalReply,/, /turnCatalogueMouth\.speakLocal && turnCatalogueMouth\.line\s*\?\s*turnCatalogueMouth\.line\s*:\s*''/]) assert.doesNotMatch(src, re);
});
