// After barge-in cancel, Soniox 400 "stream not found" must not kill TTS.
// Live miss: HD_5de59f6babc7 went silent for the rest of the call.
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastStart(socket) {
  return [...socket.sent].reverse().find((msg) => msg && msg.api_key && msg.stream_id);
}

async function main() {
  resetSonioxProviderHealth();
  const session = createSonioxTtsSession({
    callSid: 'HD_5de59f6babc7',
    onAudio: () => {},
  });
  await session.ready;
  assert.equal(sockets.length, 1);
  const socket = sockets[0];

  const firstSpeak = session.speak('We come to you for door-to-door cleaning.', {
    language: 'en',
    alreadyPrepared: true,
  });
  await delay(20);
  const first = lastStart(socket);
  assert.ok(first?.stream_id);

  session.cancel();
  const cancelled = await firstSpeak;
  assert.equal(cancelled.cancelled, true);

  socket.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        stream_id: first.stream_id,
        error_code: 400,
        error_message: `Stream ${first.stream_id} not found. Send a start message first.`,
      })
    )
  );
  await delay(20);

  const health = getSonioxProviderHealth();
  assert.equal(health.billingExhausted, false);

  const secondSpeak = session.speak('We serve Nairobi and its surrounding areas.', {
    language: 'en',
    alreadyPrepared: true,
  });
  await delay(20);
  const second = lastStart(socket);
  assert.ok(second?.stream_id);
  assert.notEqual(second.stream_id, first.stream_id);

  socket.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        stream_id: second.stream_id,
        terminated: true,
      })
    )
  );
  const result = await secondSpeak;
  assert.equal(result.cancelled, false);

  console.log('Soniox TTS stale 400 after cancel still allows the next speak().');
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
