// Streamed Gemini sentences must reach TTS. A throw inside onSpokenChunk
// (HD_fb93341c109d, HD_fe0d1e8fbd6e, HD_21b92f25640b) is caught, the
// sentence is dropped, and the turn logs outcome=stream_fallback_full.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSpokenStreamBuffer } = require('../src/speech/spokenStreamBuffer');
const { polishSpokenReply } = require('../src/conversation/dynamicSpeech');
const { cutNoAiSlop } = require('../src/speech/noAiSlop');
const { gateCallerFileSpeech } = require('../src/speech/callerFileSpeech');
const { narratesInternalAction } = require('../src/conversation/speechGuard');
const { isOrphanFragment } = require('../src/speech/outboundPcm');
const { createBrainState } = require('../src/conversation/brainState');

const REPLY =
  'We can do the couch tomorrow morning. Bring it to the gate and I will take it from there when you are ready.';

function loadSpokenChunkRunner() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('      async function onSpokenChunk(chunk) {');
  const end = source.indexOf('      async function speakLookupSentence()');
  assert.ok(start > 0 && end > start, 'onSpokenChunk source');
  const fnSrc = source.slice(start, end);
  const factory = new Function(
    'deps',
    `return async function runChunk(chunk, state) {
      const {
        polishSpokenReply,
        cutNoAiSlop,
        narratesInternalAction,
        isOrphanFragment,
        gateCallerFileSpeech,
      } = deps;
      let {
        suppressModelSpeech,
        brainState,
        brainProfile,
        capabilities,
        callLanguage,
        hidInternalNarration,
        tts,
        suppressReplyRemainder,
        bargeInActive,
        bargeCancelledText,
        firstSpokenChunk,
        spokeThisTurn,
        turnTiming,
        stopFillerForReply,
        ensureReplySpeakSession,
        speakSession,
        speaking,
        activePlaybackGeneration,
        playbackGeneration,
        streamPlaybackGen,
        speakStartedAt,
        overlapHold,
        activeOutboundStreamId,
        spokenChunks,
        lastAgentText,
        sidLabel,
      } = state;
      ${fnSrc}
      await onSpokenChunk(chunk);
      state.spokenChunks = spokenChunks;
      state.lastAgentText = lastAgentText;
      state.speakSession = speakSession;
      state.speaking = speaking;
      state.spokeThisTurn = spokeThisTurn;
      state.firstSpokenChunk = firstSpokenChunk;
      state.hidInternalNarration = hidInternalNarration;
      state.bargeCancelledText = bargeCancelledText;
    };`
  );
  return factory({
    polishSpokenReply,
    cutNoAiSlop,
    narratesInternalAction,
    isOrphanFragment,
    gateCallerFileSpeech,
  });
}

function makeState() {
  const pushed = [];
  const session = {
    streamId: 'stream-1',
    pushText(text) {
      pushed.push(text);
    },
    cancel() {},
  };
  return {
    pushed,
    suppressModelSpeech: false,
    brainState: createBrainState({ businessName: 'Chapter One', vertical: 'home_services' }),
    brainProfile: { businessName: 'Chapter One', productCatalog: [] },
    capabilities: {},
    callLanguage: 'en',
    hidInternalNarration: false,
    tts: {},
    suppressReplyRemainder: false,
    bargeInActive: false,
    bargeCancelledText: '',
    firstSpokenChunk: false,
    spokeThisTurn: false,
    turnTiming: { markFirstSpokenChunk() {} },
    stopFillerForReply() {},
    async ensureReplySpeakSession() {
      return session;
    },
    speakSession: null,
    speaking: false,
    activePlaybackGeneration: 0,
    playbackGeneration: 0,
    streamPlaybackGen: 0,
    speakStartedAt: 0,
    overlapHold: { reassignPending() {} },
    activeOutboundStreamId: null,
    spokenChunks: [],
    lastAgentText: '',
    sidLabel: () => 'HD_test',
  };
}

async function speakStreamedReply(reply) {
  const runChunk = loadSpokenChunkRunner();
  const state = makeState();
  const buffer = createSpokenStreamBuffer();
  const deltas = reply.match(/\S+\s*/g) || [reply];
  for (const delta of deltas) {
    for (const piece of buffer.push(delta)) {
      await runChunk(piece, state);
    }
  }
  for (const piece of buffer.finish()) {
    await runChunk(piece, state);
  }
  return state;
}

describe('streamed spoken chunk path', () => {
  it('pushes the full streamed reply to TTS', async () => {
    assert.ok(REPLY.length > 100, REPLY.length);
    const state = await speakStreamedReply(REPLY);
    const spoken = state.spokenChunks.join(' ');
    assert.equal(spoken, state.pushed.join(' '));
    assert.equal(
      spoken,
      'We can do the couch tomorrow morning. Bring it to the gate and I will take it from there when you are ready.'
    );
    assert.ok(spoken.length > 100, spoken);
    assert.equal(state.spokeThisTurn, true);
  });
});
