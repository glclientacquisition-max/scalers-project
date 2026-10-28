// End-to-end, v2 live path: the caller says "No thanks, that's all. Bye." and
// BA v2 ends the call once, with the goodbye in the same line, after it has
// played (end-call contract, plan C3; Voice side VOICE_END_CALL_HONOUR).
//
// Boots the real server.js with BRAIN_V2=on BRAIN_V2_MODE=live under
// tests/helpers/mediaCallSim.js (fake Soniox, seeded greeting cache),
// tests/helpers/endCallSim.js (each line plays MEDIA_SIM_LINE_MS of PCM) and
// tests/helpers/noNetworkSim.js (no request leaves the box: no Gemini call).
// A local HTTP server stands in for SautiKit REST and records the hangup.
//
// Run: node --test tests/endCallV2E2e.test.js   (Node 22, like CI)
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PRELOADS = ['mediaCallSim.js', 'endCallSim.js', 'noNetworkSim.js'].map((f) => path.join(__dirname, 'helpers', f));
const LINE_MS = 1500;
const BYE = "No thanks, that's all. Bye.";

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
async function startFakeSautikit() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url, t: Date.now() });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ call_id: 'sim', status: 'hung_up' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, hits, base: `http://127.0.0.1:${server.address().port}` };
}
async function startServer(extraEnv, sautikitBase) {
  const port = await freePort();
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
    PORT: String(port),
    SUPABASE_URL: 'http://127.0.0.1:9',
    SUPABASE_SERVICE_ROLE_KEY: 'sim-not-a-key',
    SONIOX_API_KEY: 'sim-not-a-key',
    SAUTIKIT_API_KEY: 'sim-not-a-key',
    SAUTIKIT_API_BASE: sautikitBase,
    BUSINESS_NAME: 'Jirani Cleaning Services',
    AGENT_NAME: 'Shy',
    VOICE_GREETING_WARM: 'off',
    VOICE_GREETING_CACHE: 'on',
    MEDIA_SIM_LINE_MS: String(LINE_MS),
    BRAIN_V2: 'on',
    BRAIN_V2_MODE: 'live',
    ...extraEnv,
  };
  const child = fork(path.join(ROOT, 'server.js'), [], {
    cwd: ROOT,
    env,
    execArgv: PRELOADS.flatMap((p) => ['-r', p]),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const events = [];
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += String(d); });
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
async function call(srv, rest, callSid, text, opts = {}) {
  const { child, port, events } = srv;
  const mine = (e) => String(e.callSid || '') === callSid || String(e.line || '').includes(`[${callSid}]`);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/media?callSid=${callSid}`, 'audio.drachtio.org');
  let closed = null;
  ws.on('close', (code, reason) => { closed = { code, reason: String(reason || ''), t: Date.now() }; });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ event: 'start', metadata: { callSid } }));
  const greeting = await waitFor(events, (e) => e.ev === 'log' && e.line.includes(`[voice-timing][${callSid}] connect_to_greeting_pcm_ms=`), 20000);
  assert.ok(greeting, `${callSid}: greeting never played`);
  await sleep(900);
  const from = events.length;
  say(child, callSid, text);
  const first = await waitFor(events, (e) => e.ev === 'speak' && mine(e), 4000, from);
  if (opts.thenSay && first) { await sleep(300); say(child, callSid, opts.thenSay); }
  await sleep(opts.listenMs || 6000);
  if (ws.readyState === WebSocket.OPEN) ws.close();
  const after = events.slice(from).filter(mine);
  return {
    speaks: after.filter((e) => e.ev === 'speak'),
    logs: after.filter((e) => e.ev === 'log').map((e) => e.line),
    closed,
    hangups: rest.hits.filter((h) => h.method === 'POST' && h.url === `/v1/calls/${callSid}/hangup`),
  };
}

describe('v2 live + VOICE_END_CALL_HONOUR=on: "No thanks, that\'s all. Bye."', () => {
  let srv;
  let rest;
  before(async () => {
    rest = await startFakeSautikit();
    srv = await startServer({ VOICE_END_CALL_HONOUR: 'on' }, rest.base);
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
    if (rest) rest.server.close();
  });

  it('v2 says goodbye in the same line, then one hangup after that line has played', async () => {
    const callSid = 'HD_sim_v2_end_bye';
    const r = await call(srv, rest, callSid, BYE, { thenSay: 'Bye.' });
    const live = r.logs.find((l) => l.includes('brain_v2_live'));
    assert.ok(live, `v2 live answered. Logs:\n${r.logs.join('\n')}`);
    const bye = r.speaks.find((s) => /goodbye|kwaheri/i.test(s.text));
    assert.ok(bye, `the goodbye reached the speak sink. Speaks: ${JSON.stringify(r.speaks.map((s) => s.text))}`);
    // B2: the engines stream the farewell one sentence per line; the goodbye is the last line, and the second "Bye."
    // is not answered (one owned turn only).
    assert.equal(r.speaks[r.speaks.length - 1], bye, `nothing spoken after the goodbye: ${JSON.stringify(r.speaks.map((s) => s.text))}`);
    assert.ok(r.speaks.length <= 2, `one farewell turn: ${JSON.stringify(r.speaks.map((s) => s.text))}`);
    assert.equal(r.logs.filter((l) => l.includes('brain_v2_live owned')).length, 1, 'the second "Bye." is not answered');
    assert.ok(r.logs.some((l) => l.includes('end-call signal source=v2_end')), 'v2 end signal read');
    assert.equal(r.logs.filter((l) => l.includes('end_call hangup source=')).length, 1, 'one hangup');
    assert.ok(r.closed && r.closed.code === 1000 && r.closed.reason === 'end_call', 'media closed 1000 end_call');
    assert.ok(r.closed.t - bye.t >= LINE_MS, `closed ${r.closed.t - bye.t} ms after the goodbye; it plays ${LINE_MS} ms`);
    assert.equal(r.hangups.length, 1, 'exactly one SautiKit REST hangup');
    assert.ok(!srv.events.some((e) => e.ev === 'net_blocked' && /googleapis|generativelanguage/.test(e.host)), 'no Gemini call');
  });
});

describe('v2 live, VOICE_END_CALL_HONOUR unset: v2 end is not acted on (today)', () => {
  let srv;
  let rest;
  before(async () => {
    rest = await startFakeSautikit();
    srv = await startServer({}, rest.base);
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
    if (rest) rest.server.close();
  });

  it('the goodbye is spoken; no REST hangup and no end_call close', async () => {
    const callSid = 'HD_sim_v2_end_off';
    const r = await call(srv, rest, callSid, BYE, { listenMs: 4000 });
    assert.ok(r.speaks.some((s) => /goodbye|kwaheri/i.test(s.text)), JSON.stringify(r.speaks.map((s) => s.text)));
    assert.equal(r.hangups.length, 0);
    assert.ok(!(r.closed && r.closed.reason === 'end_call'));
  });
});
