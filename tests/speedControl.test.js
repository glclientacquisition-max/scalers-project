// Caller-requested TTS speed control: detector, scale stepping, and the
// Soniox session applying the scale to the wire speed.
// Run: node tests/speedControl.test.js

const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');

const {
  detectSpeedRequest,
  nextSpeedScale,
} = require('../src/speech/speedControl');

// --- detector: slower ---
for (const text of [
  'Slower than that.',
  'Can you slow down?',
  'Please speak slowly.',
  'You are too fast.',
  'Ongea polepole.',
  'Polepole zaidi.',
  'Nataka uongee polepole.',
]) {
  const hit = detectSpeedRequest(text);
  assert.ok(hit && hit.action === 'slower', `expected slower for: ${text}`);
}

// --- detector: faster ---
for (const text of ['Faster please.', 'Speed up.', 'You are too slow.', 'Ongea haraka kidogo.']) {
  const hit = detectSpeedRequest(text);
  assert.ok(hit && hit.action === 'faster', `expected faster for: ${text}`);
}

// --- detector: reset ---
assert.strictEqual(detectSpeedRequest('Back to normal speed.').action, 'reset');
assert.strictEqual(detectSpeedRequest('Ongea kama kawaida.').action, 'reset');

// --- detector: non-requests must not trigger ---
for (const text of [
  'Kuja haraka kesho.', // come quickly — not a speech-speed ask
  'The service was slow.',
  'Nataka booking ya kesho.',
  'What are your prices?',
  '',
]) {
  assert.strictEqual(detectSpeedRequest(text), null, `should not trigger: ${text}`);
}

// --- scale stepping ---
assert.strictEqual(nextSpeedScale(1, 'slower'), 0.85);
assert.strictEqual(nextSpeedScale(0.85, 'slower'), 0.7);
assert.strictEqual(nextSpeedScale(0.7, 'slower'), 0.7); // floor
assert.strictEqual(nextSpeedScale(0.7, 'faster'), 0.85);
assert.strictEqual(nextSpeedScale(0.85, 'faster'), 1);
assert.strictEqual(nextSpeedScale(1.3, 'faster'), 1.3); // ceiling
assert.strictEqual(nextSpeedScale(0.7, 'reset'), 1);
assert.strictEqual(nextSpeedScale(1, 'reset'), 1);
// Round trip returns to exactly the default — normal speed is the anchor.
assert.strictEqual(nextSpeedScale(nextSpeedScale(1, 'slower'), 'faster'), 1);
assert.strictEqual(
  nextSpeedScale(nextSpeedScale(nextSpeedScale(1, 'slower'), 'slower'), 'reset'),
  1
);

// --- session applies the scale to the wire speed ---
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

const { createSonioxTtsSession } = require('../src/speech/sonioxTts');

async function speakSpeed(opts) {
  const session = createSonioxTtsSession({ callSid: 'speed-test', onAudio: () => {} });
  await session.ready;
  const socket = sockets[sockets.length - 1];
  const speakPromise = session.speak('Sawa Chris.', {
    language: 'en',
    alreadyPrepared: true,
    ...opts,
  });
  await new Promise((r) => setTimeout(r, 20));
  const start = socket.sent.find((msg) => msg.model);
  assert.ok(start, 'expected a TTS start message');
  socket.emit('message', Buffer.from(JSON.stringify({ stream_id: start.stream_id, terminated: true })));
  await speakPromise;
  session.close();
  return start.speed;
}

async function main() {
  // Default: profile speed (balanced = 1.0).
  assert.strictEqual(await speakSpeed({}), 1);
  // Explicit default scale is exactly the profile speed — normal is the anchor.
  assert.strictEqual(await speakSpeed({ speedScale: 1 }), 1);
  // Caller asked slower twice: scale 0.7 hits the wire.
  assert.strictEqual(await speakSpeed({ speedScale: 0.7 }), 0.7);
  // Scale multiplies an explicit hint.
  assert.strictEqual(await speakSpeed({ speed: 1.0, speedScale: 0.85 }), 0.85);
  // Scale cannot push below the clampSpeed floor.
  assert.strictEqual(await speakSpeed({ speedScale: 0.4 }), 0.7);

  console.log('speed control: detector, stepping, and wire speed all pass.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });
