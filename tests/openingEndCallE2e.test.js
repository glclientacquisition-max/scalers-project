// VOICE_OPENING_V2 silence goodbye x #842 end-call honour (VOICE_END_CALL_HONOUR).
//
// Runs only in a tree that has #842 (src/speech/endCallHonour.js and
// tests/helpers/endCallSim.js); on #843 alone it is skipped, and
// tests/openingV2E2e.test.js covers the unchanged close there.
//
// Real server.js under tests/helpers/openingSim.js + tests/helpers/endCallSim.js.
// The ladder lines play from the greeting PCM cache (OPENING_SIM_PCM_MS long);
// a live-TTS line would play MEDIA_SIM_LINE_MS. Both are LINE_MS here. A local
// HTTP server stands in for the SautiKit REST API and records hangups.
//
// Run: node --test tests/openingEndCallE2e.test.js   (Node 22)
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const SIM = path.join(__dirname, 'helpers', 'openingSim.js');
const END_SIM = path.join(__dirname, 'helpers', 'endCallSim.js');
const HAS_842 = fs.existsSync(path.join(ROOT, 'src/speech/endCallHonour.js')) && fs.existsSync(END_SIM);
const SKIP = HAS_842 ? false : '#842 (end-call honour) is not in this tree';
/** Every spoken line plays this long at the far end. */
const LINE_MS = 1500;
const GOODBYE = 'Sikusikii, kwa hivyo nitakata simu sasa. Karibu upige tena wakati wowote. Kwaheri.';

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
    VOICE_STREAM_RECORD: 'on',
    VOICE_OPENING_V2: 'on',
    VOICE_OPENING_SILENCE_MS: '600,900,900',
    MEDIA_SIM_LINE_MS: String(LINE_MS),
    OPENING_SIM_PCM_MS: String(LINE_MS),
    ...extraEnv,
  };
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

const logsOf = (srv, sid) =>
  srv.events.filter((e) => e.ev === 'log' && String(e.line || '').includes(`[${sid}]`)).map((e) => e.line);

async function silentCall(srv, rest, sid) {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/media?callSid=${sid}`, 'audio.drachtio.org');
  let closed = null;
  ws.on('close', (code, reason) => {
    closed = { code, reason: String(reason || ''), t: Date.now() };
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ event: 'start', metadata: { callSid: sid } }));
  const greeting = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] greeting mode=`), 15000);
  assert.ok(greeting, `${sid}: greeting never played`);
  // The caller never speaks: invite, Halo? invite, goodbye.
  // The goodbye starts playing: cached clip (opening_line cached=1) or live TTS.
  const hit = await waitFor(
    srv.events,
    (e) =>
      (e.ev === 'speak' && String(e.callSid || '') === sid && String(e.text || '').includes('Kwaheri')) ||
      (e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_line cached=`) && e.line.includes('Kwaheri')),
    20000
  );
  const goodbye = hit && { t: hit.t, text: hit.ev === 'speak' ? hit.text : hit.line.split(': ').slice(1).join(': ') };
  const deadline = Date.now() + 10000;
  while (!closed && Date.now() < deadline) await sleep(20);
  await sleep(1200); // anything late (a second hangup, an outage alert) shows up here
  if (ws.readyState === WebSocket.OPEN) ws.close();
  return {
    goodbye,
    closed,
    logs: logsOf(srv, sid),
    hangups: rest.hits.filter((h) => h.method === 'POST' && h.url === `/v1/calls/${sid}/hangup`),
    outageAlerts: srv.events.filter((e) => e.ev === 'log' && /\[speech-outage\]|speech provider outage/.test(e.line)),
  };
}

describe('silence goodbye with #842, VOICE_END_CALL_HONOUR=on', { skip: SKIP }, () => {
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

  it('the goodbye plays fully, one REST hangup, no outage alert', async () => {
    const sid = 'HD_sim_jirani_silent_endcall';
    const r = await silentCall(srv, rest, sid);
    assert.ok(r.goodbye, `goodbye never spoken:\n${r.logs.join('\n')}`);
    assert.equal(r.goodbye.text, GOODBYE);
    assert.ok(r.logs.some((l) => l.includes('opening_silence_end missed_call=1 hangup via end_call')), r.logs.join('\n'));
    assert.ok(r.closed, 'media socket closed');
    assert.equal(r.closed.code, 1000);
    assert.equal(r.closed.reason, 'end_call', 'closed by the end-call controller, not silence_end');
    const afterAudio = r.closed.t - r.goodbye.t;
    assert.ok(afterAudio >= LINE_MS, `closed ${afterAudio} ms after the goodbye started; it plays ${LINE_MS} ms`);
    assert.equal(r.hangups.length, 1, 'one SautiKit REST hangup');
    assert.ok(r.hangups[0].t >= r.goodbye.t + LINE_MS, 'REST hangup after the goodbye played');
    assert.equal(r.logs.filter((l) => /end_call hangup source=opening_silence waited_ms=\d+ rest=ok:200/.test(l)).length, 1, r.logs.join('\n'));
    assert.equal(r.outageAlerts.length, 0, r.outageAlerts.map((e) => e.line).join('\n'));
  });
});

describe('silence goodbye with #842 in the tree, VOICE_END_CALL_HONOUR unset: today', { skip: SKIP }, () => {
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

  it('timed close with silence_end, no REST hangup', async () => {
    const sid = 'HD_sim_jirani_silent_flagoff';
    const r = await silentCall(srv, rest, sid);
    assert.ok(r.goodbye);
    assert.ok(r.logs.some((l) => /opening_silence_end missed_call=1 hangup in \d+ms/.test(l)), r.logs.join('\n'));
    assert.ok(r.closed && r.closed.reason === 'silence_end');
    assert.equal(r.hangups.length, 0);
  });
});
