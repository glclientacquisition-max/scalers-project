'use strict';

// Factories for the demo socket. They are the same Soniox STT, Soniox TTS,
// and Brain turn used on a phone call. Loaded only when a session starts
// without a test double. No telephony client.

function createDemoStt(opts) {
  const { createSonioxSttSession } = require('../speech/sonioxStt');
  return createSonioxSttSession(opts);
}

function createDemoTts(opts) {
  const { createSonioxTtsSession } = require('../speech/sonioxTts');
  return createSonioxTtsSession(opts);
}

function createDemoBrain(opts) {
  const { answerDemoTurn } = require('./brain');
  return answerDemoTurn(opts);
}

module.exports = {
  createDemoStt,
  createDemoTts,
  createDemoBrain,
};
