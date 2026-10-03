// Voice socket cancel: abort Gemini, skip tools, stop only the playing TTS.
// Run: node --test tests/voiceSocketCancel.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  applyVoiceSocketCancel,
  planVoiceSocketCancel,
} = require('../src/speech/voiceSocketCancel');
const {
  takeGeminiVoiceStream,
  geminiTurnWasCancelled,
  cancelledGeminiTurnResult,
} = require('../src/conversation/geminiVoice');

function blockingGeminiStream(signal, state) {
  const iterator = {
    async next() {
      state.pulls += 1;
      if (state.pulls === 1) {
        return {
          done: false,
          value: {
            candidates: [{ content: { parts: [{ text: 'Hello. ' }] } }],
          },
        };
      }
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          state.ranToCompletion = true;
          resolve({
            done: false,
            value: {
              candidates: [
                {
                  content: {
                    parts: [{ text: '###TOOL###{"name":"end_call"} tail' }],
                  },
                },
              ],
            },
          });
        }, 2500);
        const onAbort = () => {
          clearTimeout(timer);
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    async return() {
      return { done: true, value: undefined };
    },
  };
  iterator[Symbol.asyncIterator] = () => iterator;
  return iterator;
}

describe('Gemini abort', () => {
  it('aborts the in-flight stream and does not run tools', async () => {
    const controller = new AbortController();
    const state = { pulls: 0, ranToCompletion: false };
    let chunks = 0;
    const started = Date.now();
    const pending = takeGeminiVoiceStream({
      client: {
        models: {
          async generateContentStream({ config }) {
            assert.equal(config.abortSignal, controller.signal);
            assert.equal(config.temperature, 0.35);
            return blockingGeminiStream(config.abortSignal, state);
          },
        },
      },
      model: 'gemini-3.6-flash',
      contents: [],
      config: { temperature: 0.35 },
      abortSignal: controller.signal,
      onChunk: async () => {
        chunks += 1;
      },
    });

    const waitUntil = Date.now() + 500;
    while (state.pulls < 2 && Date.now() < waitUntil) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(state.pulls, 2, 'the reader must be blocked on the rest of the stream');
    controller.abort();
    const read = await pending;
    assert.equal(read.aborted, true);
    assert.equal(read.consumed, 1);
    assert.equal(chunks, 1);
    assert.equal(state.ranToCompletion, false);
    assert.ok(Date.now() - started < 1500, 'abort must not wait for the stream timeout');
    assert.equal(controller.signal.aborted, true);

    let toolsRan = 0;
    if (!geminiTurnWasCancelled({ aborted: read.aborted, abortSignal: controller.signal })) {
      toolsRan += 1;
    }
    assert.equal(toolsRan, 0);
    const cancelled = cancelledGeminiTurnResult();
    assert.equal(cancelled.cancelled, true);
    assert.deepEqual(cancelled.toolResults, []);
    assert.equal(cancelled.shouldEndCall, false);
  });

  it('does not treat a finished stream as cancelled', async () => {
    const read = await takeGeminiVoiceStream({
      client: {
        models: {
          async generateContentStream() {
            return (async function* () {
              yield { candidates: [{ content: { parts: [{ text: 'We open at eight.' }] } }] };
            })();
          },
        },
      },
      model: 'gemini-3.6-flash',
      contents: [],
      config: {},
      onChunk: async () => {},
    });
    assert.equal(read.aborted, false);
    assert.equal(read.consumed, 1);
    assert.equal(geminiTurnWasCancelled({ aborted: read.aborted }), false);
  });
});

describe('voice socket cancel', () => {
  it('cancels only the playing Soniox stream and returns to listening', () => {
    const cancelled = [];
    const sent = [];
    const controller = new AbortController();
    const stt = { closed: false, close() { this.closed = true; } };
    const ctx = {
      activeOutboundStreamId: 'tts-playing',
      prefetchStreamId: 'tts-prefetch',
      playbackGeneration: 4,
      speaking: true,
      turnBusy: true,
      bargeInActive: false,
      geminiAbort: controller,
      stt,
      tts: {
        cancel(id) {
          cancelled.push(id === undefined ? 'ALL' : id);
        },
      },
      clearMediaPlayback() {
        sent.push({ type: 'killAudio' });
      },
    };

    const plan = applyVoiceSocketCancel(ctx, 'barge/caller');
    assert.equal(controller.signal.aborted, true);
    assert.deepEqual(cancelled, ['tts-playing']);
    assert.equal(plan.untouchedPrefetchId, 'tts-prefetch');
    assert.deepEqual(sent, [{ type: 'killAudio' }]);
    assert.equal(ctx.playbackGeneration, 5);
    assert.equal(ctx.speaking, false);
    assert.equal(ctx.turnBusy, false);
    assert.equal(ctx.activeOutboundStreamId, null);
    assert.equal(stt.closed, false);
    assert.equal(plan.keepStt, true);
    assert.equal(plan.skipToolApply, true);
    assert.equal(plan.killAudio, true);
  });

  it('does not cancel a prefetch that is not playing', () => {
    const plan = planVoiceSocketCancel({
      activeOutboundStreamId: 'arming-2',
      prefetchStreamId: 'tts-prefetch',
      playbackGeneration: 2,
    });
    assert.equal(plan.cancelTtsId, null);
    assert.equal(plan.untouchedPrefetchId, 'tts-prefetch');
    assert.equal(plan.playbackGeneration, 3);
    assert.equal(plan.speaking, false);
    assert.equal(plan.turnBusy, false);
  });

  it('cancels a prefetch once that stream is the one playing', () => {
    const plan = planVoiceSocketCancel({
      activeOutboundStreamId: 'tts-playing',
      prefetchStreamId: 'tts-playing',
      playbackGeneration: 1,
    });
    assert.equal(plan.cancelTtsId, 'tts-playing');
    assert.equal(plan.untouchedPrefetchId, '');
  });

  it('keeps barge-in on the same cancel entry', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = source.indexOf('function cancelInFlightVoice');
    const end = source.indexOf('function cancelSpeech');
    assert.ok(start !== -1 && end > start);
    const fn = source.slice(start, end);
    assert.match(fn, /applyVoiceSocketCancel/);
    assert.match(fn, /turnBusy = false/);
    assert.doesNotMatch(fn, /tts\.cancel\(\)/);
    assert.doesNotMatch(fn, /stt\.close|stt\.cancel/);
    assert.match(
      source,
      /function cancelSpeech\(reason\) \{\s*cancelInFlightVoice\(reason\);/
    );
  });
});
