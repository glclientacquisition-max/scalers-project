'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const { WebSocket } = require('ws');

const { createDemoGuard } = require('../src/demo/guards');
const { fixtureProfile } = require('../src/demo/profiles');
const { handleDemoUpgrade } = require('../src/demo/upgrade');
const { createDemoCodec, PCM16_FRAME_BYTES, PCM8_FRAME_BYTES } = require('../src/demo/codec');

const SECRET = 'test-token-secret';
const SALT = 'test-ip-salt';
const HOME_ID = '11111111-1111-4111-8111-111111111101';
const SHOP_ID = '11111111-1111-4111-8111-111111111102';

function tone(value, bytes = PCM16_FRAME_BYTES) {
  const pcm = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 2) pcm.writeInt16LE(value, i);
  return pcm;
}

function baseEnv(over = {}) {
  return {
    DEMO_ENABLED: 'on',
    DEMO_ALLOWED_ORIGINS: 'https://staging.example',
    DEMO_TOKEN_SECRET: SECRET,
    DEMO_IP_SALT: SALT,
    TURNSTILE_SECRET_KEY: 'turnstile-test',
    DEMO_OPUS: 'on',
    ...over,
  };
}

function fakes() {
  const sttSent = [];
  const spoken = [];
  const cancels = [];
  let onEvent = () => {};
  let onAudio = () => {};
  let hold = null;
  return {
    sttSent,
    spoken,
    cancels,
    emit(evt) { onEvent(evt); },
    pushMore(value) { onAudio(tone(value)); },
    createStt({ onEvent: cb }) {
      onEvent = cb;
      return {
        ready: Promise.resolve(),
        sendAudio(buf) { sttSent.push(Buffer.from(buf)); },
        sendKeepalive() {},
        close() {},
      };
    },
    createTts({ onAudio: cb }) {
      onAudio = cb;
      return {
        ready: Promise.resolve(),
        speak(text) {
          spoken.push(String(text));
          cb(tone(1000));
          if (String(text).startsWith('HOLD')) {
            return new Promise((resolve) => { hold = resolve; });
          }
          return Promise.resolve({ cancelled: false });
        },
        cancel() {
          cancels.push(1);
          if (hold) {
            const resolve = hold;
            hold = null;
            resolve();
          }
        },
        close() {},
      };
    },
  };
}

function guardFor(env, lines) {
  const clock = { t: Date.parse('2026-10-31T08:00:00Z') };
  const guard = createDemoGuard({
    env,
    now: () => clock.t,
    fetch: async () => ({ json: async () => ({ success: true }) }),
    log: (line) => lines.push(line),
  });
  return { guard, clock };
}

async function mint(guard, { tenant = 'home', lang = 'en', device = 'device-1234' } = {}) {
  const out = await guard.decide({
    method: 'POST',
    headers: { origin: 'https://staging.example', host: 'voice.example' },
    body: {
      tenant,
      lang,
      turnstile: 'ok-token',
      device_id: device,
      consent_ts: 1760000000000,
      notice_v: '2026-10-31',
    },
    ip: '203.0.113.10',
  });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  return out.body.token;
}

function spySautikit() {
  const hits = [];
  const orig = {
    http: http.request,
    https: https.request,
    fetch: global.fetch,
  };
  function note(value) {
    const text = String(value || '');
    if (text.includes('sautikit')) hits.push(text);
  }
  function wrap(args) {
    const first = args[0];
    if (typeof first === 'string' || first instanceof URL) note(first);
    else if (first && typeof first === 'object') note(first.href || first.host || first.hostname || '');
    const second = args[1];
    if (second && typeof second === 'object') note(second.hostname || second.host || second.href || '');
  }
  http.request = function spiedHttp(...args) {
    wrap(args);
    return orig.http.apply(this, args);
  };
  https.request = function spiedHttps(...args) {
    wrap(args);
    return orig.https.apply(this, args);
  };
  global.fetch = async function spiedFetch(url, init) {
    note(url && url.url ? url.url : url);
    return orig.fetch(url, init);
  };
  return {
    hits,
    restore() {
      http.request = orig.http;
      https.request = orig.https;
      global.fetch = orig.fetch;
    },
  };
}

async function boot(env, lines, opts = {}) {
  const { guard } = guardFor(env, lines);
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  server.on('upgrade', (req, socket, head) => {
    handleDemoUpgrade(req, socket, head, {
      env,
      guard,
      log: (line) => lines.push(line),
      ledger: opts.ledger,
      maxMs: opts.maxMs == null ? 60000 : opts.maxMs,
      idleMs: opts.idleMs == null ? 60000 : opts.idleMs,
      silenceGate: false,
      createStt: opts.audio && opts.audio.createStt,
      createTts: opts.audio && opts.audio.createTts,
      brain: opts.brain,
      loadProfile: opts.loadProfile || (async () => null),
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, guard, port: server.address().port };
}

function connect(port, token, { codec, origin, protocols } = {}) {
  const query = token ? `t=${encodeURIComponent(token)}` : 't=';
  const codecQuery = codec ? `&codec=${codec}` : '';
  const url = `ws://127.0.0.1:${port}/ws/demo?${query}${codecQuery}`;
  const ws = new WebSocket(url, protocols, {
    headers: { origin: origin == null ? 'https://staging.example' : origin },
  });
  const messages = [];
  let settled = false;
  const result = new Promise((resolve) => {
    function done(extra) {
      if (settled) return;
      settled = true;
      resolve({ ws, messages, ...extra });
    }
    ws.on('message', (data, isBinary) => {
      if (isBinary) messages.push({ binary: Buffer.from(data) });
      else messages.push({ json: JSON.parse(data.toString()) });
    });
    ws.on('open', () => done({ status: 101 }));
    ws.on('unexpected-response', (_req, res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* no json */ }
        done({
          status: res.statusCode,
          reason: res.headers['x-demo-reason'],
          body,
        });
      });
    });
    ws.on('error', () => {});
  });
  return result;
}

function waitFor(list, pred, ms = 2000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const found = list.find(pred);
      if (found) return resolve(found);
      if (Date.now() - start > ms) {
        return reject(new Error(`timeout ${list.length}`));
      }
      setTimeout(check, 10);
    }
    check();
  });
}

describe('demo websocket session', () => {
  const open = [];
  after(async () => {
    for (const server of open) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function started(opts = {}) {
    const lines = [];
    const env = baseEnv(opts.env);
    const audio = opts.audio || fakes();
    const brain = opts.brain || (async ({ lang }) => ({
      text: lang === 'sw' ? 'Bei iko kwenye orodha.' : 'The price is on the list.',
      lang,
    }));
    const serverBox = await boot(env, lines, { ...opts, audio, brain });
    open.push(serverBox.server);
    const token = await mint(serverBox.guard, opts.mint);
    return { ...serverBox, lines, audio, token, env };
  }

  it('ends a valid token on the socket when the flag drops, and keeps HTTP for a missing or bad token', async () => {
    const lines = [];
    const env = baseEnv();
    const audio = fakes();
    const box = await boot(env, lines, { audio });
    open.push(box.server);
    const token = await mint(box.guard);
    env.DEMO_ENABLED = 'off';
    const refused = await connect(box.port, token, { codec: 'pcm16' });
    assert.equal(refused.status, 101);
    const end = await waitFor(refused.messages, (m) => m.json && m.json.type === 'end');
    assert.equal(end.json.reason, 'kill');
    assert.deepEqual(Object.keys(end.json), ['type', 'reason']);
    assert.equal(audio.spoken.length, 0);
    const reused = await connect(box.port, token, { codec: 'pcm16' });
    assert.equal(reused.status, 401);
    assert.equal(reused.reason, 'reused');
    const absent = await connect(box.port, '', { codec: 'pcm16' });
    assert.equal(absent.status, 404);
    assert.equal(absent.reason, 'disabled');
    const bad = await connect(box.port, 'not-a-token', { codec: 'pcm16' });
    assert.equal(bad.status, 401);
    assert.equal(bad.reason, 'rejected');
    env.DEMO_ENABLED = 'on';
    const missing = await connect(box.port, '', { codec: 'pcm16' });
    assert.equal(missing.status, 401);
    assert.equal(missing.reason, 'rejected');
  });

  it('accepts a valid token at the spend cap and ends with cap before any speech', async () => {
    const { createDemoLedger, createMemorySpendStore } = require('../src/demo/meter');
    const lines = [];
    const env = baseEnv();
    const audio = fakes();
    const ledger = createDemoLedger({
      store: createMemorySpendStore(),
      env,
      now: () => Date.parse('2026-10-31T08:00:00Z'),
    });
    await ledger.ready();
    await ledger.record({
      sessionId: 'demo_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      minutes: 1,
      sttSeconds: 60,
      ttsSeconds: 20,
      modelInputTokens: 10,
      modelOutputTokens: 20,
      costUsd: 2,
    });
    const box = await boot(env, lines, { audio, ledger });
    open.push(box.server);
    const token = await mint(box.guard);
    const conn = await connect(box.port, token, { codec: 'pcm16' });
    assert.equal(conn.status, 101);
    const end = await waitFor(conn.messages, (m) => m.json && m.json.type === 'end');
    assert.equal(end.json.reason, 'cap');
    assert.equal(audio.spoken.length, 0);
    assert.equal(audio.sttSent.length, 0);
    const text = lines.join('\n');
    assert.equal(text.includes('203.0.113.10'), false);
    assert.equal(text.includes('device-1234'), false);
  });

  it('rejects a bad origin and a reused token, and opus when DEMO_OPUS is not on', async () => {
    const lines = [];
    const env = baseEnv({ DEMO_OPUS: 'off' });
    const audio = fakes();
    const box = await boot(env, lines, { audio });
    open.push(box.server);
    const token = await mint(box.guard);
    const origin = await connect(box.port, token, { codec: 'pcm16', origin: 'https://evil.example' });
    assert.equal(origin.status, 403);
    assert.equal(origin.reason, 'origin');
    const opus = await connect(box.port, token, { codec: 'opus' });
    assert.equal(opus.status, 400);
    assert.equal(opus.reason, 'codec');
    const ok = await connect(box.port, token, { codec: 'pcm16' });
    assert.equal(ok.status, 101);
    const again = await connect(box.port, token, { codec: 'pcm16' });
    assert.equal(again.status, 401);
    assert.equal(again.reason, 'reused');
    ok.ws.close();
  });

  it('speaks the fixture greeting, runs a brain reply, and does not apply phone gain', async () => {
    const spy = spySautikit();
    try {
      const profileLoads = [];
      const session = await started({
        mint: { tenant: 'home', lang: 'en' },
        loadProfile(profile) {
          profileLoads.push({ id: profile.id, keys: Object.keys(profile) });
          return {
            id: 'not-a-demo',
            businessName: 'Aris',
            greetingText: 'This is the Aris line +254709221536',
            businessPolicies: { demo: true },
          };
        },
      });
      const conn = await connect(session.port, session.token, { codec: 'pcm16' });
      assert.equal(conn.status, 101);
      const startedMsg = await waitFor(conn.messages, (m) => m.json && m.json.type === 'session');
      assert.equal(startedMsg.json.tenant, 'demo_home');
      assert.equal(startedMsg.json.tenant_id, HOME_ID);
      assert.equal(startedMsg.json.lang, 'en');
      assert.equal(startedMsg.json.codec, 'pcm16');
      assert.equal(startedMsg.json.recording, false);
      assert.equal(startedMsg.json.sample_rate, 16000);
      assert.equal(startedMsg.json.frame_ms, 20);
      const greeting = fixtureProfile('demo_home').openers.en;
      const caption = await waitFor(conn.messages, (m) => m.json && m.json.type === 'caption' && m.json.role === 'assistant');
      assert.equal(caption.json.text, greeting);
      assert.equal(caption.json.lang, 'en');
      const audio = await waitFor(conn.messages, (m) => m.binary);
      assert.deepEqual(audio.binary, tone(1000));
      assert.equal(profileLoads[0].id, HOME_ID);
      assert.equal(JSON.stringify(conn.messages).includes('+254709221536'), false);
      assert.equal(JSON.stringify(conn.messages).includes('Aris'), false);

      session.audio.emit({ type: 'transcript', text: 'How much is a visit?', isFinal: true });
      const reply = await waitFor(conn.messages, (m) => m.json && m.json.type === 'caption' && m.json.text === 'The price is on the list.');
      assert.equal(reply.json.role, 'assistant');
      assert.equal(reply.json.lang, 'en');
      const caller = conn.messages.find((m) => m.json && m.json.role === 'caller');
      assert.equal(caller.json.text, 'How much is a visit?');
      assert.equal(caller.json.final, true);
      assert.equal(session.lines.some((line) => line.includes('How much is a visit?')), false);
      assert.deepEqual(spy.hits, []);
      conn.ws.close();
    } finally {
      spy.restore();
    }
  });

  it('uses the Kiswahili opener for a sw token', async () => {
    const session = await started({ mint: { tenant: 'shop', lang: 'sw', device: 'device-sw-1' } });
    const conn = await connect(session.port, session.token, { codec: 'pcm16' });
    const caption = await waitFor(conn.messages, (m) => m.json && m.json.type === 'caption' && m.json.role === 'assistant');
    assert.equal(caption.json.text, fixtureProfile('demo_shop').openers.sw);
    assert.equal(caption.json.lang, 'sw');
    const hello = await waitFor(conn.messages, (m) => m.json && m.json.type === 'session');
    assert.equal(hello.json.tenant_id, SHOP_ID);
    assert.equal(hello.json.lang, 'sw');
    conn.ws.close();
  });

  it('feeds Opus and PCM8 to STT as 16 kHz s16le', async () => {
    const opus = await started({ mint: { device: 'device-opus1' } });
    const opusConn = await connect(opus.port, opus.token, { codec: 'opus' });
    await waitFor(opusConn.messages, (m) => m.json && m.json.type === 'session');
    const encoder = createDemoCodec('opus');
    const packet = encoder.encode(tone(8000))[0];
    opusConn.ws.send(packet, { binary: true });
    await waitFor(opus.audio.sttSent, (buf) => buf.length === PCM16_FRAME_BYTES);
    assert.notDeepEqual(opus.audio.sttSent[0], packet);
    encoder.close();
    opusConn.ws.close();

    const pcm = await started({
      env: { DEMO_OPUS: 'off' },
      mint: { device: 'device-pcm8x' },
    });
    const pcmConn = await connect(pcm.port, pcm.token, { codec: 'pcm8' });
    await waitFor(pcmConn.messages, (m) => m.json && m.json.type === 'session');
    const pcm8 = tone(8000, PCM8_FRAME_BYTES);
    pcmConn.ws.send(pcm8, { binary: true });
    await waitFor(pcm.audio.sttSent, (buf) => buf.length === PCM16_FRAME_BYTES);
    assert.equal(pcm.audio.sttSent[0].length, PCM16_FRAME_BYTES);
    pcmConn.ws.close();
  });

  it('cancels TTS when the caller speaks over the reply', async () => {
    const session = await started({
      mint: { device: 'device-barge' },
      brain: async () => ({ text: 'HOLD the line', lang: 'en' }),
    });
    const conn = await connect(session.port, session.token, { codec: 'pcm16' });
    await waitFor(conn.messages, (m) => m.json && m.json.type === 'state' && m.json.state === 'listening');
    const before = conn.messages.filter((m) => m.binary).length;
    session.audio.emit({ type: 'transcript', text: 'stop', isFinal: true });
    await waitFor(conn.messages, (m) => m.json && m.json.type === 'assistant_audio' && conn.messages.filter((x) => x.binary).length > before);
    const loud = tone(8000);
    conn.ws.send(loud, { binary: true });
    await waitFor(conn.messages, (m) => m.json && m.json.type === 'state' && m.json.state === 'listening' && session.audio.cancels.length > 0);
    assert.equal(session.audio.cancels.length, 1);
    assert.ok(session.audio.sttSent.some((buf) => buf.equals(loud)));
    session.audio.pushMore(2000);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const leaked = conn.messages.filter((m) => m.binary && m.binary.readInt16LE(0) === 2000);
    assert.equal(leaked.length, 0);
    assert.equal(conn.messages.some((m) => m.json && (m.json.type === 'killAudio' || m.json.event === 'clear')), false);
    conn.ws.close();
  });

  it('ends on user, max_time, idle, and kill, and releases the concurrency slot', async () => {
    const user = await started({ mint: { device: 'device-user1' }, idleMs: 30000, maxMs: 30000 });
    const live = await connect(user.port, user.token, { codec: 'pcm16' });
    await waitFor(live.messages, (m) => m.json && m.json.type === 'session');
    const busy = await user.guard.decide({
      method: 'POST',
      headers: { origin: 'https://staging.example' },
      body: {
        tenant: 'home',
        lang: 'en',
        turnstile: 'ok-token',
        device_id: 'device-user1',
        consent_ts: 1760000000000,
        notice_v: '2026-10-31',
      },
      ip: '203.0.113.10',
    });
    assert.equal(busy.status, 429);
    assert.equal(busy.body.reason, 'rate');
    live.ws.send(JSON.stringify({ type: 'end' }));
    const ended = await waitFor(live.messages, (m) => m.json && m.json.type === 'end');
    assert.equal(ended.json.reason, 'user');
    await new Promise((resolve) => {
      if (live.ws.readyState === WebSocket.CLOSED) return resolve();
      live.ws.once('close', resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const again = await mint(user.guard, { device: 'device-user1' });
    assert.ok(again);

    const timed = await started({ mint: { device: 'device-time1' }, maxMs: 200, idleMs: 10000 });
    const timedConn = await connect(timed.port, timed.token, { codec: 'pcm16' });
    const maxEnd = await waitFor(timedConn.messages, (m) => m.json && m.json.type === 'end', 2000);
    assert.equal(maxEnd.json.reason, 'max_time');
    assert.ok(timed.audio.spoken.includes('Thank you. Goodbye.'));

    const idle = await started({ mint: { device: 'device-idle1', lang: 'sw', tenant: 'other' }, idleMs: 200, maxMs: 10000 });
    const idleConn = await connect(idle.port, idle.token, { codec: 'pcm16' });
    const idleEnd = await waitFor(idleConn.messages, (m) => m.json && m.json.type === 'end', 2000);
    assert.equal(idleEnd.json.reason, 'idle');
    assert.ok(idle.audio.spoken.includes('Asante. Kwaheri.'));

    const kill = await started({ mint: { device: 'device-kill1' } });
    const killConn = await connect(kill.port, kill.token, { codec: 'pcm16' });
    await waitFor(killConn.messages, (m) => m.json && m.json.type === 'session');
    kill.env.DEMO_ENABLED = 'off';
    killConn.ws.send(JSON.stringify({ type: 'ping' }));
    const killed = await waitFor(killConn.messages, (m) => m.json && m.json.type === 'end');
    assert.equal(killed.json.reason, 'kill');
  });

  it('does not select the drachtio subprotocol', async () => {
    const session = await started({ mint: { device: 'device-proto' } });
    const headerText = await new Promise((resolve, reject) => {
      const sock = net.connect({ port: session.port, host: '127.0.0.1' }, () => {
        sock.setTimeout(2000);
        sock.write([
          `/ws/demo?t=${encodeURIComponent(session.token)} HTTP/1.1`.replace(/^/, 'GET '),
          'Host: 127.0.0.1',
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          'Origin: https://staging.example',
          'Sec-WebSocket-Protocol: audio.drachtio.org',
          '',
          '',
        ].join('\r\n'));
      });
      let buf = '';
      sock.on('timeout', () => {
        sock.destroy();
        reject(new Error('upgrade timed out'));
      });
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        if (buf.includes('\r\n\r\n')) {
          sock.end();
          resolve(buf);
        }
      });
      sock.on('error', reject);
    });
    assert.match(headerText, /^HTTP\/1\.1 101/);
    assert.equal(headerText.toLowerCase().includes('audio.drachtio.org'), false);
  });

  it('keeps the phone upgrade branch and gain path free of the demo socket', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const media = source.slice(
      source.indexOf("pathname === '/ws/media'"),
      source.indexOf("pathname === '/ws/relay'")
    );
    assert.equal(media.includes('demo'), false);
    const relayAt = source.indexOf("pathname === '/ws/relay'");
    const demoAt = source.indexOf("pathname === '/ws/demo'");
    assert.ok(demoAt > relayAt);
    const gain = source.slice(source.indexOf('function sendPcmToMedia'), source.indexOf('function clearMediaPlayback'));
    assert.match(gain, /applyPcmGain/);
    assert.equal(gain.includes('demo'), false);
    const incoming = source.slice(
      source.indexOf('async function handleVoiceIncoming'),
      source.indexOf('function handleSautikitRootPost')
    );
    assert.equal(incoming.includes('DEMO_'), false);
    for (const file of ['codec.js', 'session.js', 'upgrade.js', 'pipeline.js', 'brain.js', 'profiles.js']) {
      const text = fs.readFileSync(path.join(__dirname, '..', 'src/demo', file), 'utf8');
      assert.doesNotMatch(text, /sautikit\.com/);
      assert.equal(text.includes('/v1/calls'), false, file);
      assert.equal(text.includes('/v1/webrtc'), false, file);
      assert.equal(text.includes('applyPcmGain'), false, file);
      assert.equal(text.includes('hangupSautikitCall'), false, file);
    }
    const pipeline = fs.readFileSync(path.join(__dirname, '..', 'src/demo/pipeline.js'), 'utf8');
    assert.match(pipeline, /createSonioxSttSession/);
    assert.match(pipeline, /createSonioxTtsSession/);
    assert.match(pipeline, /answerDemoTurn/);
    const brain = fs.readFileSync(path.join(__dirname, '..', 'src/demo/brain.js'), 'utf8');
    assert.match(brain, /runBrainEnginesTurn/);
    assert.match(brain, /results: \[\]/);
  });
});
