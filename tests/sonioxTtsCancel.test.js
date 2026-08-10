// Ensure TTS cancel unblocks local speak() waiters immediately.
// Run: node tests/sonioxTtsCancel.test.js

const assert = require('assert');
const Module = require('module');
const path = require('path');
const EventEmitter = require('events');

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
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

async function main() {
  const session = createSonioxTtsSession({
    callSid: 'cancel-test',
    onAudio: () => {},
  });
  await session.ready;

  const speakPromise = session.speak('Sawa, nakucheckia.', {
    language: 'en',
    alreadyPrepared: true,
  });

  // Cancel before any remote `terminated` arrives — speak must still resolve.
  await new Promise((r) => setTimeout(r, 20));
  session.cancel();

  const result = await Promise.race([
    speakPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('speak() did not resolve after cancel')), 500)
    ),
  ]);

  assert.strictEqual(result.cancelled, true);
  console.log('Soniox TTS cancel unblocks speak() waiter.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });
