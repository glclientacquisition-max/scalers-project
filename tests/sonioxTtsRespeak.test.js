// VOICE_TTS_RESPEAK: a Soniox TTS socket close or transient error mid-line
// never leaves a written reply unspoken. Replays the 13 Oct Esga calls
// (HD_116ff6a67508, HD_1e4e3e955169): Soniox closed the idle socket with
// 1001 Timeout under a prefetched reply stream, the rejection was unhandled,
// Node crashed, and the caller heard silence.
// Run: node --test tests/sonioxTtsRespeak.test.js

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');
const fixture = require('./fixtures/tts-socket-close-2026-10-13.json');

const sockets = [];
let autoOpen = true;

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    sockets.push(this);
    if (autoOpen) {
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.emit('open');
      });
    }
  }

  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('not open');
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }

  close() {
    this.serverClose(1000, '');
  }

  /** Soniox (or the network) closes the socket. */
  serverClose(code, reason) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason || ''));
  }

  reply(obj) {
    this.emit('message', Buffer.from(JSON.stringify(obj)));
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

const {
  createSonioxTtsSession,
  isTtsRespeakEnabled,
  isTransientTtsFault,
} = require('../src/speech/sonioxTts');
const { classifySonioxError } = require('../src/speech/sonioxErrors');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const starts = (socket) => socket.sent.filter((m) => m && m.api_key);
const texts = (socket, wire) =>
  socket.sent.filter((m) => m.stream_id === wire && typeof m.text === 'string' && m.text_end === false).map((m) => m.text);
const ended = (socket, wire) => socket.sent.some((m) => m.stream_id === wire && m.text_end === true);
const pcm = (n = 640) => Buffer.alloc(n, 1).toString('base64');

let unhandled = [];
function onUnhandled(reason) {
  unhandled.push(reason);
}
let warnLines = [];
const origWarn = console.warn;
const origLog = console.log;
const origError = console.error;

function makeSession(extra = {}) {
  const audio = [];
  const events = [];
  const session = createSonioxTtsSession({
    callSid: extra.callSid || 'HD_test',
    onAudio: (buf, meta) => audio.push({ bytes: buf.length, ...meta }),
    onEvent: (evt) => events.push(evt),
    ...extra,
  });
  return { session, audio, events };
}

const respeakLogs = () => warnLines.filter((l) => l.includes('] respeak stream='));

beforeEach(() => {
  sockets.length = 0;
  autoOpen = true;
  unhandled = [];
  warnLines = [];
  process.on('unhandledRejection', onUnhandled);
  console.warn = (...a) => warnLines.push(a.join(' '));
  console.log = () => {};
  console.error = () => {};
  delete process.env.VOICE_TTS_RESPEAK;
  delete process.env.VOICE_TTS_RESPEAK_CONNECT_MS;
  delete process.env.VOICE_TTS_RESPEAK_MAX;
  delete process.env.VOICE_TTS_IDLE_RECYCLE_MS;
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  console.warn = origWarn;
  console.log = origLog;
  console.error = origError;
});

describe('13 Oct replay: idle 1001 Timeout under a prefetched reply stream', () => {
  const call = fixture.calls[0];

  it('fixture matches the prod evidence', () => {
    assert.equal(call.callSid, 'HD_116ff6a67508');
    assert.equal(call.ttsClose.code, 1001);
    assert.equal(call.ttsClose.reason, 'Timeout');
    assert.ok(call.greeting.cached, 'greeting came from cache, so the TTS socket sat idle');
    assert.ok(call.socketIdleMsBeforeClose > 9000);
    assert.equal(fixture.calls[1].ttsClose.code, 1001);
  });

  it('does not crash, reconnects, and speaks the reply (switch on, default)', async () => {
    assert.equal(isTtsRespeakEnabled(), true, 'on by default in code');
    const { session, audio } = makeSession({ callSid: call.callSid, fallbackPcm: async () => assert.fail('no fallback needed') });
    await session.ready;
    const first = sockets[0];
    // llm→tts stream prefetched; nothing sent yet (config waits for the first chunk).
    const reply = await session.beginSpeak({ callLanguage: 'sw' });
    assert.equal(starts(first).length, 0);
    first.serverClose(call.ttsClose.code, call.ttsClose.reason);
    await delay(10);
    assert.equal(unhandled.length, 0, 'socket close under a prefetched stream must not be an unhandled rejection');
    assert.equal(sockets.length, 2, 'reconnected');
    reply.pushText('Pole, sina details za order hiyo hapa.');
    reply.pushText('Unaitwa nani?');
    const done = reply.end();
    const second = sockets[1];
    const wire = starts(second)[0].stream_id;
    assert.equal(wire, `${reply.streamId}-r1`);
    assert.deepEqual(texts(second, wire), ['Pole, sina details za order hiyo hapa.', ' Unaitwa nani?']);
    assert.ok(ended(second, wire));
    second.reply({ stream_id: wire, audio: pcm(), audio_end: true });
    second.reply({ stream_id: wire, terminated: true });
    const out = await done;
    assert.equal(out.cancelled, false);
    assert.equal(audio.length, 1);
    assert.equal(audio[0].streamId, reply.streamId, 'audio keeps the stream id the server is gating on');
    assert.equal(session.respeaksUsed, 0, 'a reconnect with nothing said costs no re-speak');
    assert.equal(respeakLogs().length, 1);
    assert.match(respeakLogs()[0], /close=1001 reason=Timeout .*outcome=reconnected/);
  });

  it('switch off: same rejection as before, still never unhandled', async () => {
    process.env.VOICE_TTS_RESPEAK = 'off';
    const { session } = makeSession({ callSid: call.callSid });
    await session.ready;
    const reply = await session.beginSpeak({ callLanguage: 'sw' });
    sockets[0].serverClose(1001, 'Timeout');
    await delay(10);
    assert.equal(unhandled.length, 0);
    await assert.rejects(reply.done, /TTS socket closed \(1001\)/);
    assert.equal(sockets.length, 1, 'no reconnect with the switch off');
    assert.equal(respeakLogs().length, 0);
  });
});

describe('mid-line close', () => {
  it('re-speaks the same line from the start on a fresh socket', async () => {
    const { session, audio } = makeSession({ fallbackPcm: async () => assert.fail('no fallback') });
    await session.ready;
    const line = 'Sawa, nimehifadhi ombi lako.';
    const p = session.speak(line, { language: 'sw', alreadyPrepared: true });
    await delay(5);
    const first = sockets[0];
    const wire1 = starts(first)[0].stream_id;
    first.reply({ stream_id: wire1, audio: pcm() }); // part of the line played
    first.serverClose(1006, '');
    await delay(10);
    const second = sockets[1];
    const start2 = starts(second)[0];
    assert.equal(start2.stream_id, `${wire1}-r1`);
    assert.equal(start2.language, 'sw');
    assert.deepEqual(texts(second, start2.stream_id), [line]);
    assert.ok(ended(second, start2.stream_id), 'text_end re-sent because the line was complete');
    second.reply({ stream_id: start2.stream_id, audio: pcm(), audio_end: true });
    second.reply({ stream_id: start2.stream_id, terminated: true });
    const out = await p;
    assert.equal(out.cancelled, false);
    assert.deepEqual(audio.map((a) => a.streamId), [wire1, wire1]);
    assert.equal(session.respeaksUsed, 1);
    assert.equal(respeakLogs().length, 1, 'one log line per event');
    assert.match(respeakLogs()[0], /close=1006 .*heard_bytes=640 outcome=respoken used=1\/2/);
  });

  it('does not double-speak when the socket closes after the audio finished', async () => {
    const fallback = [];
    const { session, audio } = makeSession({ fallbackPcm: async (t) => fallback.push(t) });
    await session.ready;
    const p = session.speak('Asante, Chris.', { language: 'sw', alreadyPrepared: true });
    await delay(5);
    const first = sockets[0];
    const wire = starts(first)[0].stream_id;
    first.reply({ stream_id: wire, audio: pcm(), audio_end: true });
    first.serverClose(1001, 'Timeout'); // before `terminated`
    const out = await p;
    assert.equal(out.closedAfterAudio, true);
    await delay(10);
    assert.equal(sockets.length, 1, 'no reconnect');
    assert.equal(fallback.length, 0);
    assert.equal(audio.length, 1);
    assert.equal(session.respeaksUsed, 0);
    assert.match(respeakLogs()[0], /outcome=skipped_audio_complete/);
  });

  it('stays quiet when the caller barged in', async () => {
    let barged = false;
    const fallback = [];
    const { session } = makeSession({
      fallbackPcm: async (t) => fallback.push(t),
      shouldRespeak: () => !barged,
    });
    await session.ready;
    const p = session.speak('Tafadhali niambie jina lako.', { language: 'sw', alreadyPrepared: true });
    await delay(5);
    barged = true;
    sockets[0].serverClose(1006, '');
    const out = await p;
    assert.equal(out.cancelled, true);
    await delay(10);
    assert.equal(sockets.length, 1);
    assert.equal(fallback.length, 0);
    assert.match(respeakLogs()[0], /outcome=skipped_barge/);
  });

  it('stops the re-speak when barge-in cancels during the reconnect', async () => {
    autoOpen = true;
    const { session } = makeSession({ fallbackPcm: async () => assert.fail('no fallback') });
    await session.ready;
    const reply = await session.beginSpeak({ language: 'en', alreadyPrepared: true });
    reply.pushText('Let me check that.');
    const done = reply.end();
    autoOpen = false; // reconnect hangs
    sockets[0].serverClose(1006, '');
    await delay(5);
    session.cancel(); // barge-in
    const out = await done;
    assert.equal(out.cancelled, true);
    // The reconnect opens late: nothing is replayed onto it.
    sockets[1].readyState = FakeWebSocket.OPEN;
    sockets[1].emit('open');
    await delay(10);
    assert.equal(starts(sockets[1]).length, 0);
  });

  it('call ended (session closed): no re-speak, no fallback', async () => {
    const fallback = [];
    const { session } = makeSession({ fallbackPcm: async (t) => fallback.push(t) });
    await session.ready;
    const p = session.speak('Kwaheri.', { language: 'sw', alreadyPrepared: true });
    await delay(5);
    session.close();
    const out = await p;
    assert.equal(out.cancelled, true);
    await delay(10);
    assert.equal(fallback.length, 0);
    assert.equal(sockets.length, 1);
  });
});

describe('fallback chain', () => {
  it('reconnect times out (bounded) → the same line goes to the fallback chain', async () => {
    process.env.VOICE_TTS_RESPEAK_CONNECT_MS = '40';
    const calls = [];
    const { session, audio } = makeSession({
      fallbackPcm: async (text, meta) => {
        calls.push({ text, meta });
        return { pcm: Buffer.alloc(3200, 2), source: 'espeak' };
      },
    });
    await session.ready;
    const reply = await session.beginSpeak({ language: 'sw', alreadyPrepared: true });
    reply.pushText('Pole sana kwa tatizo hili.');
    reply.pushText('Tafadhali niambie jina lako.');
    const done = reply.end();
    autoOpen = false;
    const t0 = Date.now();
    sockets[0].serverClose(1001, 'Timeout');
    const out = await done;
    const ms = Date.now() - t0;
    assert.ok(ms < 1000, `bounded, took ${ms}ms`);
    assert.equal(out.fallback, 'espeak');
    assert.equal(out.pcm, null, 'fallback audio never feeds the Soniox caches');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, 'Pole sana kwa tatizo hili. Tafadhali niambie jina lako.');
    assert.equal(calls[0].meta.language, 'sw');
    assert.equal(audio.length, 1);
    assert.equal(audio[0].fallback, 'espeak');
    assert.equal(audio[0].streamId, reply.streamId);
    assert.equal(respeakLogs().length, 1);
    assert.match(respeakLogs()[0], /outcome=fallback_espeak .*why=reconnect_failed/);
    // The abandoned connect does not block the next line for 10 s.
    autoOpen = true;
    const t1 = Date.now();
    const next = await session.beginSpeak({ language: 'en', alreadyPrepared: true });
    assert.ok(Date.now() - t1 < 200, 'next line connects fresh');
    next.cancel();
  });

  it('streamed reply still being written: fallback waits for the full line', async () => {
    process.env.VOICE_TTS_RESPEAK_CONNECT_MS = '30';
    const calls = [];
    const { session } = makeSession({
      fallbackPcm: async (text) => {
        calls.push(text);
        return Buffer.alloc(320, 3);
      },
    });
    await session.ready;
    const reply = await session.beginSpeak({ language: 'en', alreadyPrepared: true });
    reply.pushText('One moment.');
    autoOpen = false;
    sockets[0].serverClose(1006, '');
    await delay(60); // reconnect gave up; reply not ended yet
    assert.equal(calls.length, 0);
    const pushed = reply.pushText('I will check the order.');
    assert.equal(pushed.pushed, true, 'later chunks are kept, not thrown');
    const out = await reply.end();
    assert.equal(out.fallback, 'fallback');
    assert.deepEqual(calls, ['One moment. I will check the order.']);
  });

  it('re-spoken line lost again → fallback (one re-speak per line)', async () => {
    const calls = [];
    const { session } = makeSession({
      fallbackPcm: async (text) => {
        calls.push(text);
        return { pcm: Buffer.alloc(320), source: 'gemini' };
      },
    });
    await session.ready;
    const p = session.speak('Naweza kusaidia?', { language: 'sw', alreadyPrepared: true });
    await delay(5);
    sockets[0].serverClose(1006, '');
    await delay(10);
    sockets[1].serverClose(1006, '');
    const out = await p;
    assert.equal(out.fallback, 'gemini');
    assert.equal(sockets.length, 2, 'no third socket for the same line');
    assert.deepEqual(calls, ['Naweza kusaidia?']);
    assert.equal(respeakLogs().length, 2);
    assert.match(respeakLogs()[1], /outcome=fallback_gemini .*why=budget/);
  });

  it('caps re-speaks per call at 2', async () => {
    const calls = [];
    const { session } = makeSession({
      fallbackPcm: async (text) => {
        calls.push(text);
        return Buffer.alloc(320);
      },
    });
    await session.ready;
    for (let i = 0; i < 3; i += 1) {
      const p = session.speak(`Line ${i}.`, { language: 'en', alreadyPrepared: true });
      await delay(5);
      const sock = sockets[sockets.length - 1];
      sock.serverClose(1006, '');
      await delay(10);
      if (i < 2) {
        const live = sockets[sockets.length - 1];
        const wire = starts(live).at(-1).stream_id;
        live.reply({ stream_id: wire, audio: pcm(), audio_end: true });
        live.reply({ stream_id: wire, terminated: true });
      }
      await p;
    }
    assert.equal(session.respeaksUsed, 2);
    assert.deepEqual(calls, ['Line 2.'], 'third lost line goes straight to fallback');
  });

  it('fallback also fails → rejects like before (no silent success)', async () => {
    process.env.VOICE_TTS_RESPEAK_CONNECT_MS = '20';
    const { session } = makeSession({ fallbackPcm: async () => null });
    await session.ready;
    const p = session.speak('Sawa.', { language: 'sw', alreadyPrepared: true });
    await delay(5);
    autoOpen = false;
    sockets[0].serverClose(1001, 'Timeout');
    await assert.rejects(p, /TTS socket closed \(1001\)/);
    assert.match(respeakLogs()[0], /outcome=fallback_failed/);
    assert.equal(unhandled.length, 0);
  });
});

describe('transient stream errors', () => {
  it('classifies transient vs permanent', () => {
    assert.equal(isTransientTtsFault(classifySonioxError({ error_code: 503, error_message: 'busy' })), true);
    assert.equal(isTransientTtsFault(classifySonioxError({ error_code: 429, error_message: 'rate' })), true);
    assert.equal(isTransientTtsFault(classifySonioxError(new Error('TTS socket closed (1001)'))), true);
    assert.equal(isTransientTtsFault(classifySonioxError({ error_code: 402, error_message: 'balance exhausted' })), false);
    assert.equal(isTransientTtsFault(classifySonioxError({ error_code: 400, error_message: 'Stream x not found' })), false);
    assert.equal(isTransientTtsFault(classifySonioxError({ error_code: 400, error_message: 'bad voice' })), false);
  });

  it('503 mid-line re-speaks on the same open socket', async () => {
    const { session } = makeSession({ fallbackPcm: async () => assert.fail('no fallback') });
    await session.ready;
    const p = session.speak('Tuko wazi saa tatu.', { language: 'sw', alreadyPrepared: true });
    await delay(5);
    const sock = sockets[0];
    const wire1 = starts(sock)[0].stream_id;
    sock.reply({ stream_id: wire1, error_code: 503, error_message: 'Service unavailable' });
    await delay(10);
    assert.equal(sockets.length, 1);
    const wire2 = starts(sock)[1].stream_id;
    assert.equal(wire2, `${wire1}-r1`);
    assert.deepEqual(texts(sock, wire2), ['Tuko wazi saa tatu.']);
    // Late audio from the dead wire is dropped.
    sock.reply({ stream_id: wire1, audio: pcm() });
    sock.reply({ stream_id: wire2, audio: pcm(), audio_end: true });
    sock.reply({ stream_id: wire2, terminated: true });
    const out = await p;
    assert.equal(out.cancelled, false);
  });

  it('a permanent 400 goes to the fallback chain, not a retry loop', async () => {
    const calls = [];
    const { session } = makeSession({
      fallbackPcm: async (t) => {
        calls.push(t);
        return Buffer.alloc(320);
      },
    });
    await session.ready;
    const p = session.speak('Hello.', { language: 'en', alreadyPrepared: true });
    await delay(5);
    const sock = sockets[0];
    const wire = starts(sock)[0].stream_id;
    sock.reply({ stream_id: wire, error_code: 400, error_message: 'Invalid voice settings' });
    const out = await p;
    assert.equal(out.fallback, 'fallback');
    assert.equal(starts(sock).length, 1);
    assert.deepEqual(calls, ['Hello.']);
  });
});

describe('idle socket recycle', () => {
  it('opens a fresh socket before a line when the old one sat idle past the threshold', async () => {
    process.env.VOICE_TTS_IDLE_RECYCLE_MS = '30';
    const { session } = makeSession();
    await session.ready;
    await delay(50);
    const reply = await session.beginSpeak({ language: 'en', alreadyPrepared: true });
    assert.equal(sockets.length, 2);
    assert.equal(sockets[0].readyState, FakeWebSocket.CLOSED);
    reply.pushText('Hi.');
    assert.equal(starts(sockets[1]).length, 1, 'the old socket close did not null the new one');
    assert.equal(respeakLogs().length, 0, 'a planned recycle is not a lost line');
    reply.cancel();
  });

  it('keeps a recently used socket', async () => {
    process.env.VOICE_TTS_IDLE_RECYCLE_MS = '5000';
    const { session } = makeSession();
    await session.ready;
    const reply = await session.beginSpeak({ language: 'en', alreadyPrepared: true });
    assert.equal(sockets.length, 1);
    reply.cancel();
  });
});
