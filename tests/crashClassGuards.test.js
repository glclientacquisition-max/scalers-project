// Crash class audit (17 Oct, follow-up to #736): every fire-and-forget
// promise on the Voice call path either handles its own rejection or fails
// only its own line. Sockets keep an 'error' listener for their whole life.
// Run: node --test tests/crashClassGuards.test.js

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const EventEmitter = require('events');

const sockets = [];
let autoOpen = true;
class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    sockets.push(this);
    if (!autoOpen) return;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    });
  }
  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('not open');
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }
  close() {
    this.serverClose(1000, '');
  }
  terminate() {
    this.serverClose(1006, '');
  }
  serverClose(code, reason) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason || ''));
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
process.env.SONIOX_STT_CONTEXT = 'off';

const { createSonioxSttSession } = require('../src/speech/sonioxStt');
const { createSonioxTtsSession } = require('../src/speech/sonioxTts');
const { createVoiceTrace } = require('../src/speech/voiceTrace');
const { asyncRoute } = require('../src/lib/asyncRoute');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const starts = (socket) => socket.sent.filter((m) => m && m.api_key);

let unhandled = [];
const onUnhandled = (reason) => unhandled.push(reason);
const orig = { log: console.log, warn: console.warn, error: console.error };

beforeEach(() => {
  sockets.length = 0;
  autoOpen = true;
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  Object.assign(console, orig);
});

describe('Soniox STT socket', () => {
  it('a second ws error does not throw an uncaught error event', async () => {
    const stt = createSonioxSttSession({ callSid: 'HD_stt', onEvent: () => {} });
    await stt.ready;
    const sock = sockets[0];
    assert.ok(sock.listenerCount('error') >= 1, 'error listener kept after open');
    assert.doesNotThrow(() => sock.emit('error', new Error('read ECONNRESET')));
    assert.doesNotThrow(() => sock.emit('error', new Error('Invalid WebSocket frame')));
    assert.ok(sock.listenerCount('error') >= 1, 'still listening after two errors');
    stt.close();
    await delay(5);
    assert.equal(unhandled.length, 0);
  });

  it('a connect error before open rejects ready (handled) and a later error is safe', async () => {
    const stt = createSonioxSttSession({ callSid: 'HD_stt2', onEvent: () => {} });
    const sock = sockets[0];
    sock.emit('error', new Error('getaddrinfo ENOTFOUND'));
    await assert.rejects(stt.ready, /ENOTFOUND/);
    assert.doesNotThrow(() => sock.emit('error', new Error('again')));
    stt.close();
  });
});

describe('Soniox TTS socket', () => {
  it('errors after open (twice) never become an uncaught error event', async () => {
    const tts = createSonioxTtsSession({ callSid: 'HD_tts', onAudio: () => {} });
    await tts.ready;
    const sock = sockets[0];
    assert.doesNotThrow(() => sock.emit('error', new Error('read ECONNRESET')));
    assert.doesNotThrow(() => sock.emit('error', new Error('Invalid WebSocket frame')));
    tts.close();
    await delay(5);
    assert.equal(unhandled.length, 0);
  });

  it('a throw inside the fallback path fails that line, not the process', async () => {
    process.env.VOICE_TTS_RESPEAK_CONNECT_MS = '20';
    const tts = createSonioxTtsSession({
      callSid: 'HD_tts_fb',
      onAudio: () => {
        throw new Error('media socket gone');
      },
      fallbackPcm: async () => ({ pcm: Buffer.alloc(320, 1), source: 'espeak' }),
    });
    try {
      await tts.ready;
      const p = tts.speak('Sawa.', { language: 'sw', alreadyPrepared: true });
      await delay(5);
      // The reconnect never opens: the line goes to the fallback chain,
      // whose onAudio throws.
      autoOpen = false;
      sockets[0].serverClose(1001, 'Timeout');
      await assert.rejects(p, /TTS socket closed \(1001\)/);
      await delay(10);
      assert.equal(unhandled.length, 0, 'no unhandled rejection from the recovery path');
    } finally {
      delete process.env.VOICE_TTS_RESPEAK_CONNECT_MS;
      tts.close();
    }
  });
});

describe('voice trace at hang-up', () => {
  it('finishCall resolves when the sink write rejects', async () => {
    const trace = createVoiceTrace({
      enabled: true,
      callId: 'c1',
      tenantId: 't1',
      sink: {
        write: async () => {
          throw new Error('supabase 503');
        },
      },
    });
    const record = await trace.finishCall();
    assert.equal(record.callId, 'c1');
  });
});

describe('async ops routes', () => {
  it('a rejected handler replies 500 instead of an unhandled rejection', async () => {
    const res = {
      headersSent: false,
      code: null,
      body: null,
      status(c) {
        this.code = c;
        return this;
      },
      json(b) {
        this.body = b;
        this.headersSent = true;
        return this;
      },
    };
    asyncRoute('t', async () => {
      throw new Error('provider down');
    })({}, res, () => {});
    await delay(5);
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { ok: false, error: 'internal_error' });
    assert.equal(unhandled.length, 0);
  });
});

describe('server.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  it('installs the process guards right after dotenv, before any other module', () => {
    const guard = src.indexOf("require('./src/lib/processGuards').installProcessGuards()");
    assert.ok(guard > 0);
    assert.ok(guard < src.indexOf("require('express')"));
  });

  it('fire-and-forget call-path promises carry a catch', () => {
    assert.doesNotMatch(src, /void handleSpeechProviderOutage\(/);
    assert.doesNotMatch(src, /void voiceTrace\.finishCall\(\)/);
    assert.doesNotMatch(src, /void speakText\(replay/);
    // B2: the mid-turn notify after the old LLM recovery save is deleted with that recovery; no bare notify is left
    assert.doesNotMatch(src, /maybeSendWhatsAppNotification\(sidLabel\(\)\);/);
    assert.match(src, /maybeSendWhatsAppNotification\(callSid, \{ midCall: true \}\)\.catch\(/);
    assert.match(src, /buildSttContext\(sttTenantSnapshot\)\)\s*\.catch\(\(\) => null\)/);
  });

  it('owner lead notify never rejects on a failed call lookup', () => {
    const at = src.indexOf('async function maybeSendWhatsAppNotification');
    const body = src.slice(at, at + 600);
    assert.match(body, /try \{\s*call = await db\.getCall\(callSid\);/);
  });

  it('async ops routes go through asyncRoute', () => {
    for (const route of ['/internal/sms/status', '/internal/telephony/wallet-probe', '/internal/platform/ops-alert']) {
      assert.match(src, new RegExp(`'${route.replace(/\//g, '\\/')}', asyncRoute\\(`));
    }
  });
});
