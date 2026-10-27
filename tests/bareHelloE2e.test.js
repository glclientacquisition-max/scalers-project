// End-to-end: a bare "Hello." after a cached greeting must reach the speak sink.
//
// Boots the real server.js in a child process with tests/helpers/mediaCallSim.js
// preloaded (fake Soniox STT/TTS, seeded greeting PCM cache, no network), opens a
// real /ws/media call, lets the greeting play through playCachedFillerPcm, then
// pushes the STT final "Hello." + endpoint the way src/speech/sonioxStt.js emits
// them. Everything between (onSttEvent → decideCallerEvent / hear_again →
// agentReplay → turn merge → runCallerTurn → speakText → tts.beginSpeak) is the
// production code path.
//
// Root cause (#735, prod 10-17 Oct): the cached greeting never calls
// agentReplay.beginSpeech, so hear_again replays '' and the turn ends in silence.
//
// Run: node --test tests/bareHelloE2e.test.js   (Node 22, like CI)
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const SIM = path.join(__dirname, 'helpers', 'mediaCallSim.js');
const BARE = ['Hello.', 'Hello?', 'Yes.', 'Yeah.'];
/** A reply must reach the speak sink this soon after the endpoint. */
const REPLY_BOUND_MS = 3000;
/** Flag off: how long we listen to prove the line stays silent. */
const SILENCE_WINDOW_MS = 3000;
const GREETING_TIMEOUT_MS = 20000;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * One server.js child. Only the env below reaches it: no Supabase, Gemini or
 * Soniox credentials, and SUPABASE_URL points at a closed local port.
 */
async function startServer(flag) {
  const port = await freePort();
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
    PORT: String(port),
    SUPABASE_URL: 'http://127.0.0.1:9',
    SUPABASE_SERVICE_ROLE_KEY: 'sim-not-a-key',
    SONIOX_API_KEY: 'sim-not-a-key',
    BUSINESS_NAME: 'Jirani Cleaning Services',
    AGENT_NAME: 'Shy',
    VOICE_GREETING_WARM: 'off',
    VOICE_GREETING_CACHE: 'on',
  };
  if (flag != null) env.VOICE_BARE_GREETING_REPLY = flag;
  const child = fork(path.join(ROOT, 'server.js'), [], {
    cwd: ROOT,
    env,
    execArgv: ['-r', SIM],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const events = [];
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  child.stdout.on('data', () => {});
  child.on('message', (m) => {
    events.push({ ...m, t: Date.now() });
  });
  const ready = await waitFor(
    events,
    (e) => e.ev === 'log' && /Server listening on port/.test(e.line),
    15000
  );
  if (!ready) {
    child.kill('SIGKILL');
    throw new Error(`server.js did not boot under the sim (Node 22 required):\n${stderr.slice(-2000)}`);
  }
  return { child, port, events };
}

function waitFor(events, pred, ms, from = 0) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const hit = events.slice(from).find(pred);
      if (hit) return resolve(hit);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(tick, 20);
    };
    tick();
  });
}

// Calls in one suite run concurrently on one server (one callSid each, like
// live traffic); each tenant load takes ~7 s offline while the DB read fails.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One call: connect, let the cached greeting finish, say `text`, endpoint.
 * Returns what the caller heard after the final.
 */
async function bareHelloCall(srv, callSid, text) {
  const { child, port, events } = srv;
  const mine = (e) => String(e.callSid || '') === callSid || String(e.line || '').includes(`[${callSid}]`);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/media?callSid=${callSid}`, 'audio.drachtio.org');
  const audio = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) audio.push(Date.now());
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ event: 'start', metadata: { callSid } }));

  const greeting = await waitFor(
    events,
    (e) => e.ev === 'log' && e.line.includes(`[voice-timing][${callSid}] connect_to_greeting_pcm_ms=`),
    GREETING_TIMEOUT_MS
  );
  assert.ok(greeting, `${callSid}: greeting never played`);
  // 0.3 s cached clip; playCachedFillerPcm sleeps its duration, then settles.
  await sleep(900);
  const greetingLine = (events.find((e) => e.ev === 'log' && e.line.includes(`[ws/media][${callSid}] greeting mode=`)) || {}).line || '';
  const greetingSpoken = events.filter((e) => e.ev === 'speak' && mine(e));
  const greetingAudioFrames = audio.length;

  const from = events.length;
  const sentAt = Date.now();
  const tokens = [{ text, final: true, start_ms: 9000, end_ms: 9400, language: 'en' }];
  child.send({ cmd: 'stt', callSid, evt: { type: 'transcript', text, isFinal: true, tokens, tokenLanguages: ['en'] } });
  child.send({ cmd: 'stt', callSid, evt: { type: 'endpoint', tokens: [] } });

  const reply = await waitFor(events, (e) => e.ev === 'speak' && mine(e), REPLY_BOUND_MS, from);
  if (!reply) await sleep(Math.max(0, SILENCE_WINDOW_MS - (Date.now() - sentAt)));
  else await sleep(100);
  const after = events.slice(from).filter(mine);
  ws.close();
  return {
    greeting,
    greetingLine,
    greetingSpoken,
    greetingAudioFrames,
    reply,
    replyMs: reply ? reply.t - sentAt : null,
    audioAfterFinal: audio.filter((t) => t >= sentAt).length,
    logs: after.filter((e) => e.ev === 'log').map((e) => e.line),
    stray: events.slice(from).filter((e) => e.ev === 'stt_drop'),
  };
}

function assertCachedGreeting(r, callSid) {
  assert.match(r.greeting.line, /cached=1/, `${callSid}: greeting must play from cached PCM`);
  assert.match(r.greetingLine, /How can I help\?/, `${callSid}: greeting asks a question`);
  assert.equal(r.greetingSpoken.length, 0, `${callSid}: cached greeting must not go through TTS`);
  assert.ok(r.greetingAudioFrames > 0, `${callSid}: greeting PCM reached the caller socket`);
  assert.equal(r.stray.length, 0, `${callSid}: STT events reached the call`);
}

describe('bare Hello after a cached greeting, VOICE_BARE_GREETING_REPLY=1 (e2e server.js)', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer('1');
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  for (const [i, text] of BARE.entries()) {
    it(`"${text}" gets a spoken reply within ${REPLY_BOUND_MS} ms, never silence`, async () => {
      const callSid = `HD_sim_bare_on_${i}`;
      const r = await bareHelloCall(srv, callSid, text);
      assertCachedGreeting(r, callSid);
      assert.ok(r.reply, `${text}: nothing reached the speak sink (silent return). Logs:\n${r.logs.join('\n')}`);
      assert.ok(r.reply.text.trim().length > 5, `${text}: spoken reply is non-empty`);
      assert.ok(r.replyMs <= REPLY_BOUND_MS, `${text}: reply took ${r.replyMs} ms`);
      assert.ok(r.audioAfterFinal > 0, `${text}: reply PCM reached the caller socket`);
      // The re-invite path, not a lucky fallback.
      assert.ok(
        r.logs.some((l) => l.includes(`bare_greeting_reinvite n=1 src=turn: ${text}`)),
        `${text}: expected bare_greeting_reinvite. Logs:\n${r.logs.join('\n')}`
      );
      assert.equal(r.reply.text, 'Hi, this is Shy at Jirani Cleaning Services. How can I help?');
    });
  }
});

// Flag off: today's behaviour, asserted so a change is noticed. "Hello." and
// "Hello?" are the #735 bug (hear_again with an empty replay: silence). "Yes." /
// "Yeah." after a greeting that asks a question become a normal caller turn
// (no Gemini here, so the brain's no-model line is what speaks).
describe('bare Hello after a cached greeting, flag OFF (documents current behaviour)', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer(null);
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  for (const [i, text] of ['Hello.', 'Hello?'].entries()) {
    it(`"${text}": KNOWN BUG with the flag off, silence (no speak, no audio)`, async () => {
      const callSid = `HD_sim_bare_off_${i}`;
      const r = await bareHelloCall(srv, callSid, text);
      assertCachedGreeting(r, callSid);
      assert.equal(r.reply, null, `${text}: flag off now speaks "${r.reply && r.reply.text}"; update this test and #735`);
      assert.equal(r.audioAfterFinal, 0, `${text}: no audio reached the caller`);
      assert.ok(!r.logs.some((l) => /bare_greeting_reinvite/.test(l)), 'no re-invite with the flag off');
    });
  }

  for (const [i, text] of ['Yes.', 'Yeah.'].entries()) {
    it(`"${text}": flag off, runs as a normal caller turn and speaks`, async () => {
      const callSid = `HD_sim_bare_off_${i + 2}`;
      const r = await bareHelloCall(srv, callSid, text);
      assertCachedGreeting(r, callSid);
      assert.ok(r.reply && r.reply.text.trim(), `${text}: expected a normal turn reply`);
      assert.ok(r.logs.some((l) => l.includes(`caller turn lang=`) && l.endsWith(`: ${text}`)), `${text}: normal turn`);
      assert.ok(!r.logs.some((l) => /bare_greeting_reinvite/.test(l)), 'no re-invite with the flag off');
    });
  }
});
