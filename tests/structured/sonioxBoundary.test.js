// The flag decides which boundary a Soniox TTS stream uses. Off: the legacy
// prepareForTts path, byte for byte. On: the structured boundary with a word
// gap between pieces.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const EventEmitter = require('events');
const { prepareForTts } = require('../../src/speech/ttsNormalize');

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open');
    });
  }
  send(data) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }
  close() {
    this.readyState = 3;
    this.emit('close', 1000, Buffer.from(''));
  }
}
FakeWebSocket.OPEN = 1;

async function wireFor(pieces, { flag, beginOpts = {} } = {}) {
  const originalLoad = Module._load;
  const before = process.env.VOICE_STRUCTURED_OUTPUT;
  if (flag == null) delete process.env.VOICE_STRUCTURED_OUTPUT;
  else process.env.VOICE_STRUCTURED_OUTPUT = flag;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'ws') return FakeWebSocket;
    return originalLoad(request, parent, isMain);
  };
  process.env.SONIOX_API_KEY = process.env.SONIOX_API_KEY || 'test-key';
  try {
    delete require.cache[require.resolve('../../src/speech/sonioxTts')];
    const { createSonioxTtsSession } = require('../../src/speech/sonioxTts');
    const session = createSonioxTtsSession({ callSid: 'structured-boundary', onAudio: () => {} });
    await session.ready;
    const taps = [];
    const stream = await session.beginSpeak({ callLanguage: 'en', onPiece: (p) => taps.push(p), ...beginOpts });
    const results = pieces.map((piece) => stream.pushText(piece));
    const sent = FakeWebSocket.last.sent.filter(
      (m) => m.stream_id === stream.streamId && m.text_end === false && typeof m.text === 'string'
    );
    stream.cancel();
    session.close();
    return { wire: sent.map((m) => m.text), results, taps };
  } finally {
    Module._load = originalLoad;
    if (before == null) delete process.env.VOICE_STRUCTURED_OUTPUT;
    else process.env.VOICE_STRUCTURED_OUTPUT = before;
  }
}

const PIECES = ['Yes, we cover Kitengela!', 'Interior window cleaning is KSh 200 per window.', 'What day and time would work for you?'];

describe('Soniox TTS boundary under VOICE_STRUCTURED_OUTPUT', () => {
  it('flag off: every piece is exactly prepareForTts output (legacy wire)', async () => {
    for (const flag of [null, 'off', '0']) {
      const { wire, taps } = await wireFor(PIECES, { flag });
      assert.deepEqual(
        wire,
        PIECES.map((p) => prepareForTts(p, { callLanguage: 'en' }).text),
        `flag=${flag}`
      );
      assert.equal(taps.length, 0);
    }
  });

  it('flag on: structured boundary, word gap from the second piece, tap sees each piece', async () => {
    const { wire, results, taps } = await wireFor(PIECES, { flag: 'on' });
    assert.deepEqual(wire, [
      'Yes we cover Kitengela',
      ' Interior window cleaning is two hundred shillings per window',
      ' What day and time would work for you',
    ]);
    assert.doesNotMatch(wire.join(''), /[a-z][A-Z]/);
    assert.equal(results[1].wire, wire[1]);
    assert.equal(taps.length, 3);
  });

  it('flag on: letterless pieces are refused and do not consume the first slot', async () => {
    const { wire } = await wireFor([',', 'Sure.', ' - ', 'What day works?'], { flag: 'on' });
    assert.deepEqual(wire, ['Sure', ' What day works']);
  });

  it('alreadyPrepared streams (fillers, cached greetings) never use the structured boundary', async () => {
    const { wire } = await wireFor(['already prepared text'], { flag: 'on', beginOpts: { alreadyPrepared: true } });
    assert.deepEqual(wire, ['already prepared text']);
  });

  it('a per-piece locked language reaches the boundary', async () => {
    const { results } = await wireFor(['Bei ni shilingi 6,000.'], { flag: 'on', beginOpts: { lockedLanguage: 'sw' } });
    assert.equal(results[0].language, 'sw');
    assert.equal(results[0].text, 'Bei ni shilingi elfu sita');
  });
});
