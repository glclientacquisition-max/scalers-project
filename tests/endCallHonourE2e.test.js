// End-to-end: the brain's end signal hangs up the SautiKit call once, after the
// final audio has played, and nothing after hangup is treated as an outage.
//
// Boots the real server.js under tests/helpers/mediaCallSim.js (#836: fake
// Soniox STT/TTS, seeded greeting cache, no network) plus
// tests/helpers/endCallSim.js (each spoken line plays MEDIA_SIM_LINE_MS of PCM;
// optional fake Gemini). A local HTTP server stands in for the SautiKit REST
// API (SAUTIKIT_API_BASE) and records POST /v1/calls/{sid}/hangup.
//
// Signals covered: v1 brain END (caller says "Goodbye.") and the v1 end_call
// marker (###ENDCALL### from the model). The v2 { end: true } shape is covered
// by unit tests (tests/endCallHonour.test.js); v2 is not on main.
//
// Run: node --test tests/endCallHonourE2e.test.js   (Node 22, like CI)
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const SIM = path.join(__dirname, 'helpers', 'mediaCallSim.js');
const END_SIM = path.join(__dirname, 'helpers', 'endCallSim.js');
/** Every spoken line plays this long at the far end. */
const LINE_MS = 1500;
const GREETING_TIMEOUT_MS = 20000;
const GEMINI_SCRIPT = [
  { match: 'call me back', delayMs: 30, text: 'Sure, the team will call you back. Goodbye! ###ENDCALL###' },
  { match: 'clean sofas', delayMs: 1500, text: 'Yes, we clean sofas. Would you like to book a visit?' },
  { delayMs: 30, text: 'Okay.' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function waitFor(list, pred, ms, from = 0) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const hit = list.slice(from).find(pred);
      if (hit) return resolve(hit);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(tick, 20);
    };
    tick();
  });
}

/** Fake SautiKit REST: records hangups, answers like the docs. */
async function startFakeSautikit() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', t: Date.now() });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ call_id: 'sim', status: 'hung_up' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, hits, base: `http://127.0.0.1:${server.address().port}` };
}

async function startServer(flag, sautikitBase) {
  const port = await freePort();
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
    PORT: String(port),
    SUPABASE_URL: 'http://127.0.0.1:9',
    SUPABASE_SERVICE_ROLE_KEY: 'sim-not-a-key',
    SONIOX_API_KEY: 'sim-not-a-key',
    GEMINI_API_KEY: 'sim-not-a-key',
    SAUTIKIT_API_KEY: 'sim-not-a-key',
    SAUTIKIT_API_BASE: sautikitBase,
    BUSINESS_NAME: 'Jirani Cleaning Services',
    AGENT_NAME: 'Shy',
    VOICE_GREETING_WARM: 'off',
    VOICE_GREETING_CACHE: 'on',
    MEDIA_SIM_LINE_MS: String(LINE_MS),
    MEDIA_SIM_GEMINI: JSON.stringify(GEMINI_SCRIPT),
  };
  if (flag != null) env.VOICE_FAREWELL_HANGUP = flag;
  const child = fork(path.join(ROOT, 'server.js'), [], {
    cwd: ROOT,
    env,
    execArgv: ['-r', SIM, '-r', END_SIM],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const events = [];
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  child.stdout.on('data', () => {});
  child.on('message', (m) => events.push({ ...m, t: Date.now() }));
  const ready = await waitFor(events, (e) => e.ev === 'log' && /Server listening on port/.test(e.line), 15000);
  if (!ready) {
    child.kill('SIGKILL');
    throw new Error(`server.js did not boot under the sim (Node 22 required):\n${stderr.slice(-2000)}`);
  }
  return { child, port, events };
}

function say(child, callSid, text) {
  const tokens = [{ text, final: true, start_ms: 9000, end_ms: 9400, language: 'en' }];
  child.send({ cmd: 'stt', callSid, evt: { type: 'transcript', text, isFinal: true, tokens, tokenLanguages: ['en'] } });
  child.send({ cmd: 'stt', callSid, evt: { type: 'endpoint', tokens: [] } });
}

/**
 * One call: connect, let the cached greeting finish, say `text`.
 * opts.callerHangsUpAfterMs: the caller hangs up that long after the endpoint.
 * opts.thenSay: a second caller line sent while the hangup is pending.
 */
async function endCall(srv, rest, callSid, text, opts = {}) {
  const { child, port, events } = srv;
  const mine = (e) => String(e.callSid || '') === callSid || String(e.line || '').includes(`[${callSid}]`);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/media?callSid=${callSid}`, 'audio.drachtio.org');
  let closed = null;
  ws.on('close', (code, reason) => {
    closed = { code, reason: String(reason || ''), t: Date.now() };
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
  await sleep(900);
  const from = events.length;
  const sentAt = Date.now();
  say(child, callSid, text);
  if (opts.callerHangsUpAfterMs != null) {
    await sleep(opts.callerHangsUpAfterMs);
    ws.close(1000, 'caller_hangup');
  }
  const lastSpeak = await waitFor(events, (e) => e.ev === 'speak' && mine(e), 4000, from);
  if (opts.thenSay && lastSpeak) {
    await sleep(300);
    say(child, callSid, opts.thenSay);
  }
  await sleep(opts.listenMs || 6000);
  if (ws.readyState === WebSocket.OPEN) ws.close();
  const after = events.slice(from).filter(mine);
  return {
    sentAt,
    speaks: after.filter((e) => e.ev === 'speak'),
    logs: after.filter((e) => e.ev === 'log').map((e) => e.line),
    closed,
    hangups: rest.hits.filter((h) => h.method === 'POST' && h.url === `/v1/calls/${callSid}/hangup`),
  };
}

function assertHungUpAfterAudio(r, callSid, line) {
  const farewell = r.speaks.find((s) => s.text.includes(line));
  assert.ok(farewell, `${callSid}: "${line}" reached the speak sink. Logs:\n${r.logs.join('\n')}`);
  assert.ok(r.closed, `${callSid}: media socket closed`);
  assert.equal(r.closed.code, 1000);
  assert.equal(r.closed.reason, 'end_call');
  const afterAudio = r.closed.t - farewell.t;
  assert.ok(afterAudio >= LINE_MS, `${callSid}: closed ${afterAudio} ms after the farewell started; it plays ${LINE_MS} ms`);
  assert.ok(afterAudio <= LINE_MS + 3000, `${callSid}: hung up promptly (${afterAudio} ms)`);
  assert.equal(r.hangups.length, 1, `${callSid}: exactly one SautiKit REST hangup`);
  assert.equal(r.hangups[0].auth, 'Bearer sim-not-a-key');
  assert.ok(r.hangups[0].t <= r.closed.t + 50, 'REST hangup before (or with) the media close');
  assert.ok(r.logs.some((l) => /end_call hangup source=\S+ waited_ms=\d+ rest=ok:200/.test(l)));
}

describe('VOICE_FAREWELL_HANGUP=on (e2e server.js)', { concurrency: true }, () => {
  let srv;
  let rest;
  before(async () => {
    rest = await startFakeSautikit();
    srv = await startServer('on', rest.base);
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
    if (rest) rest.server.close();
  });

  it('brain END ("Goodbye."): one hangup after the farewell has played; a second "Bye." does not hang up twice', async () => {
    const callSid = 'HD_sim_end_on_brain';
    const r = await endCall(srv, rest, callSid, 'Goodbye.', { thenSay: 'Bye.' });
    assertHungUpAfterAudio(r, callSid, 'Thank you. Goodbye.');
    assert.ok(r.logs.some((l) => l.includes('end_call scheduled source=brain_end')));
    assert.equal(r.logs.filter((l) => l.includes('end_call hangup source=')).length, 1, 'one hangup');
    assert.equal(r.speaks.length, 1, 'nothing spoken after the farewell');
  });

  it('v1 end_call marker (###ENDCALL###): one hangup after the last line has played', async () => {
    const callSid = 'HD_sim_end_on_marker';
    const r = await endCall(srv, rest, callSid, 'Please have them call me back.');
    assertHungUpAfterAudio(r, callSid, 'Goodbye!');
    assert.ok(r.logs.some((l) => l.includes('end-call signal source=v1_end_call')));
  });

  it('HD_2ccfbf6e1fa4 shape: the reply lands after the caller hung up: no outage clip, no owner alert', async () => {
    const callSid = 'HD_sim_end_on_late';
    const r = await endCall(srv, rest, callSid, 'Do you clean sofas?', { callerHangsUpAfterMs: 300, listenMs: 4000 });
    assert.ok(
      r.logs.some((l) => /speech outage suppressed \(tts unavailable\): call ended why=media_closed/.test(l)),
      `guard fired. Logs:\n${r.logs.join('\n')}`
    );
    assert.ok(!r.logs.some((l) => l.includes('speech provider outage')), 'no downtime clip');
    assert.ok(!srv.events.some((e) => e.ev === 'log' && e.line.includes('[speech-outage]')), 'no owner outage alert');
    assert.equal(r.hangups.length, 0, 'the caller hung up; we did not');
  });
});

// Flag off: today's behaviour, asserted so a change is noticed.
describe('VOICE_FAREWELL_HANGUP unset (documents current behaviour)', { concurrency: true }, () => {
  let srv;
  let rest;
  before(async () => {
    rest = await startFakeSautikit();
    srv = await startServer(null, rest.base);
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
    if (rest) rest.server.close();
  });

  it('brain END: media close on the old byte timer, no REST hangup', async () => {
    const callSid = 'HD_sim_end_off_brain';
    const r = await endCall(srv, rest, callSid, 'Goodbye.');
    assert.ok(r.closed && r.closed.reason === 'end_call');
    assert.ok(r.logs.some((l) => /brain-end hangup in \d+ms/.test(l)));
    assert.equal(r.hangups.length, 0);
    assert.ok(!r.logs.some((l) => l.includes('end_call scheduled')));
  });

  it('v1 end_call marker: KNOWN GAP, fixed 800 ms close cuts the last line, no REST hangup', async () => {
    const callSid = 'HD_sim_end_off_marker';
    const r = await endCall(srv, rest, callSid, 'Please have them call me back.');
    const bye = r.speaks.find((s) => s.text.includes('Goodbye!'));
    assert.ok(bye && r.closed && r.closed.reason === 'end_call');
    assert.ok(r.closed.t - bye.t < LINE_MS, `closed ${r.closed.t - bye.t} ms after a ${LINE_MS} ms line started`);
    assert.equal(r.hangups.length, 0);
  });

  it('HD_2ccfbf6e1fa4 shape: KNOWN BUG, a reply after caller hangup is read as a speech outage', async () => {
    const callSid = 'HD_sim_end_off_late';
    const r = await endCall(srv, rest, callSid, 'Do you clean sofas?', { callerHangsUpAfterMs: 300, listenMs: 4000 });
    assert.ok(
      r.logs.some((l) => l.includes('speech provider outage (tts unavailable)')),
      `flag off no longer fires a false outage; update this test. Logs:\n${r.logs.join('\n')}`
    );
  });
});
