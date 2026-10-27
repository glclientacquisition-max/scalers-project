'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planLookupTurn } = require('../src/conversation/router');
const { profiles } = require('../evals/replay/profiles');

function turn(text, state, profile, language = 'en', env = { VOICE_LOOKUPS: 'on' }) {
  return planLookupTurn({
    text,
    state,
    profile: profile || profiles().carry,
    language,
    now: new Date('2026-10-19T05:00:00.000Z'),
    seed: 0,
    env,
  });
}

test('flag off returns null and does not write a topic', () => {
  const state = { conversation: {} };
  assert.equal(turn('How much is sofa cleaning?', state, undefined, 'en', { VOICE_LOOKUPS: '' }), null);
  assert.equal(state.conversation.lookupTopic, undefined);
});

test('positives answer this turn, and chatter stays with the model', () => {
  const state = { conversation: {} };
  const sofa = turn('And how much is Sofa cleaning?', state);
  assert.match(sofa.speech, /two thousand five hundred/);
  assert.equal(state.conversation.lookupTopic.serviceId.startsWith('price.'), true);

  const fee = turn('How much is the travel fee to Kileleshwa?', state);
  assert.match(fee.speech, /three hundred shillings/);
  assert.equal(state.conversation.lookupTopic.serviceId, '');
  assert.match(state.conversation.lookupTopic.areaId, /kileleshwa/);

  const cutoff = turn('And how much is the.', state);
  assert.match(cutoff.speech, /deep cleaning/i);
  assert.doesNotMatch(cutoff.speech, /two thousand five hundred/);
  assert.match(state.conversation.lookupTopic.areaId, /kileleshwa/);

  const again = turn('Travel fee?', state);
  assert.match(again.speech, /three hundred shillings/);

  assert.equal(turn('Uh, okay', state), null);
  assert.equal(turn('I need your help', state), null);
  assert.equal(turn('how much is the travel fee?', { conversation: {} }), null);

  const follow = turn('And sofa cleaning?', { conversation: {} }, profiles().menu);
  assert.match(follow.speech, /two thousand five hundred/);
  const sw = turn('Na sofa je?', { conversation: {} }, profiles().menu, 'sw');
  assert.match(sw.speech, /elfu mbili|mia tano|2,500|shilingi/);
  const curtain = turn('Na curtain cleaning?', { conversation: {} }, profiles().menu);
  assert.match(curtain.speech, /one thousand eight hundred/);
});

test('a bare price with an empty slot lists services', () => {
  const state = { conversation: {} };
  const bare = turn('How much is it?', state, undefined, 'en', { VOICE_LOOKUPS: 'price,services' });
  assert.match(bare.speech, /deep cleaning/i);
  assert.equal(state.conversation.lookupTopic.serviceId, '');
});
