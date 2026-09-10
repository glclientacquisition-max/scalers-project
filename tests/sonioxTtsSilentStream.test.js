// TTS that terminates with no PCM must log so a missing clone is not silent-success.
// Run: node tests/sonioxTtsSilentStream.test.js

const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');

const sockets = [];

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    });
  }

  send(data) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', 1000, Buffer.from(''));
  }
}
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSED = 3;

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'ws') return FakeWebSocket;
  return originalLoad(request, parent, isMain);
};

process.env.SONIOX_API_KEY = 'test-key';
process.env.SONIOX_TTS_MODEL = 'tts-rt-v1';

const { createSonioxTtsSession } = require('../src/speech/sonioxTts');
const {
  getSonioxProviderHealth,
  resetSonioxProviderHealth,
} = require('../src/speech/sonioxProviderHealth');

async function main() {
  resetSonioxProviderHealth();
  const errors = [];
  const origError = console.error;
  console.error = (...args) => {
    errors.push(args.map(String).join(' '));
  };

  try {
    const session = createSonioxTtsSession({
      callSid: 'silent-test',
      onAudio: () => {
        throw new Error('no audio expected');
      },
    });
    await session.ready;
    assert.equal(sockets.length, 1);

    const speakPromise = session.speak('Hello from Shy.', {
      language: 'en',
      alreadyPrepared: true,
    });

    await new Promise((r) => setTimeout(r, 20));
    const start = sockets[0].sent.find((msg) => msg.model);
    assert.ok(start, 'expected a TTS start message');
    assert.equal(start.model, 'tts-rt-v2');

    const streamId = start.stream_id;
    sockets[0].emit(
      'message',
      Buffer.from(JSON.stringify({ stream_id: streamId, terminated: true }))
    );

    await speakPromise;
    assert.ok(
      errors.some((line) => /silent stream=/.test(line) && /no PCM/.test(line)),
      `expected silent-stream log, got: ${errors.join(' | ')}`
    );
    const health = getSonioxProviderHealth();
    assert.equal(health.tts.code, 'tts_silent');
    assert.equal(health.billingExhausted, false);
  } finally {
    console.error = origError;
  }

  console.log('Soniox TTS remaps retired v1 and flags silent streams.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });
