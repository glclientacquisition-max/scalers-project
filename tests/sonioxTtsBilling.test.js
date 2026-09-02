// Soniox TTS session-level 402 must reject speak() instead of hanging silent.
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
process.env.SONIOX_VOICE = 'test-voice';

const { createSonioxTtsSession } = require('../src/speech/sonioxTts');
const {
  getSonioxProviderHealth,
  resetSonioxProviderHealth,
} = require('../src/speech/sonioxProviderHealth');

async function main() {
  resetSonioxProviderHealth();
  const session = createSonioxTtsSession({
    callSid: 'billing-test',
    onAudio: () => {},
  });
  await session.ready;
  assert.equal(sockets.length, 1);

  const speakPromise = session.speak('Hello from Shy.', {
    language: 'en',
    alreadyPrepared: true,
  });

  await new Promise((r) => setTimeout(r, 20));
  sockets[0].emit(
    'message',
    Buffer.from(
      JSON.stringify({
        error_code: 402,
        error_message:
          'Organization balance exhausted. Please either add funds manually or enable autopay.',
      })
    )
  );

  await assert.rejects(speakPromise, /balance exhausted/i);

  const health = getSonioxProviderHealth();
  assert.equal(health.billingExhausted, true);
  assert.equal(health.tts.code, 402);

  await assert.rejects(
    session.speak('Second try.', { language: 'en', alreadyPrepared: true }),
    /balance exhausted/i
  );

  console.log('Soniox TTS 402 rejects speak() and marks billing exhausted.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
    resetSonioxProviderHealth();
  });
