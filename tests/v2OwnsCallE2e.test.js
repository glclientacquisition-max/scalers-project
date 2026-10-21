// End-to-end, BRAIN_V2_OWNS_CALL=on (plan C3, "v2 owns the call"): the real
// server.js /ws/media loop with BRAIN_V2=on BRAIN_V2_MODE=live under
// tests/helpers/mediaCallSim.js (fake Soniox), endCallSim.js (each line plays
// MEDIA_SIM_LINE_MS of PCM), noNetworkSim.js (no request leaves the box: no
// Gemini, no Supabase) and v2OwnsSim.js (fixture tenant, local db writes,
// counters on every v1 guard / v1 turn path, a v1 file gate that would
// rewrite any line it sees).
//
// Run: node --test tests/v2OwnsCallE2e.test.js   (Node 22, like CI)
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PRELOADS = ['mediaCallSim.js', 'endCallSim.js', 'noNetworkSim.js', 'v2OwnsSim.js'].map((f) => path.join(__dirname, 'helpers', f));
const LINE_MS = 600;
const REPAIR_EN = "Sorry, I didn't catch that. Could you say it again?";

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
    BUSINESS_NAME: 'Done and Dusted',
    AGENT_NAME: 'Shy',
    VOICE_GREETING_WARM: 'off',
    VOICE_GREETING_CACHE: 'on',
    MEDIA_SIM_LINE_MS: String(LINE_MS),
    BRAIN_V2: 'on',
    BRAIN_V2_MODE: 'live',
    VOICE_END_CALL_HONOUR: 'on',
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
  return { child, port, events, stderr: () => stderr };
}

let clock = 9000;
function say(child, callSid, text) {
  clock += 4000;
  const tokens = [{ text, final: true, start_ms: clock, end_ms: clock + 400, language: 'en' }];
  child.send({ cmd: 'stt', callSid, evt: { type: 'transcript', text, isFinal: true, tokens, tokenLanguages: ['en'] } });
  child.send({ cmd: 'stt', callSid, evt: { type: 'endpoint', tokens: [] } });
}
// One media session; turns are spoken one at a time and each waits for its reply.
async function session(srv, callSid) {
  const { child, port, events } = srv;
  const mine = (e) => String(e.callSid || '') === callSid || String(e.line || '').includes(`[${callSid}]`);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/media?callSid=${callSid}`, 'audio.drachtio.org');
  let closed = null;
  ws.on('close', (code, reason) => { closed = { code, reason: String(reason || ''), t: Date.now() }; });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ event: 'start', metadata: { callSid } }));
  const greeting = await waitFor(events, (e) => e.ev === 'log' && e.line.includes(`[voice-timing][${callSid}] connect_to_greeting_pcm_ms=`), 20000);
  assert.ok(greeting, `${callSid}: greeting never played`);
  await sleep(700);
  const start = events.length;
  return {
    async turn(text, { waitMs = 5000, settleMs = LINE_MS + 500 } = {}) {
      const from = events.length;
      say(child, callSid, text);
      const spoke = await waitFor(events, (e) => e.ev === 'speak' && mine(e), waitMs, from);
      await sleep(settleMs);
      return spoke ? spoke.text : null;
    },
    async close(code = 1000) {
      if (ws.readyState === WebSocket.OPEN) ws.close(code);
      await sleep(800);
    },
    closed: () => closed,
    open: () => ws.readyState === WebSocket.OPEN,
    since: () => events.slice(start),
    mine: () => events.slice(start).filter(mine),
    dump: () => events.slice(start).filter(mine).map((e) => (e.ev === 'speak' ? `SPEAK ${e.text}` : e.ev === 'log' ? e.line : JSON.stringify(e))).join('\n'),
  };
}
const v1Calls = (evs) => evs.filter((e) => e.ev === 'v1');
const dbCalls = (evs, fn) => evs.filter((e) => e.ev === 'db' && e.fn === fn);

describe('BRAIN_V2_OWNS_CALL=on: v2 is the only owner of the call', () => {
  let srv;
  let rest;
  before(async () => {
    rest = await startFakeSautikit();
    srv = await startServer({ BRAIN_V2_OWNS_CALL: 'on', V2_SIM_THROW: 'SIMTHROW' }, rest.base);
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
    if (rest) rest.server.close();
  });

  it('a v2 throw mid-turn speaks the v2 repair line, with zero v1 calls', async () => {
    const s = await session(srv, 'HD_sim_c3_throw');
    const heard = await s.turn('SIMTHROW what are your hours');
    assert.equal(heard, REPAIR_EN);
    const evs = s.since();
    assert.deepEqual(v1Calls(evs).map((e) => e.fn), [], 'no v1 guard, lookup, local reply, model turn or file gate ran');
    assert.ok(!evs.some((e) => e.ev === 'net_blocked' && /googleapis|generativelanguage/.test(e.host)), 'no Gemini call');
    assert.ok(s.mine().some((e) => e.ev === 'log' && /brain_v2_owned repair reason=throw/.test(e.line)));
    assert.equal(s.mine().filter((e) => e.ev === 'speak').length, 1, 'one line, not repair + v1');
    // The call carries on in v2 on the next turn.
    const next = await s.turn('What are your hours?');
    assert.ok(next && next !== REPAIR_EN && !/EDITED/.test(next), next);
    await s.close();
  });

  it('a v2 booking writes through the executor with no guardToolPlan; the v1 file gate never edits a v2 line', async () => {
    const s = await session(srv, 'HD_sim_c3_book');
    const rb = await s.turn('Book sofa cleaning on Friday at 10am in Kitengela, my name is Alvin.');
    assert.match(rb || '', /Shall I book it\?$/, s.dump());
    const done = await s.turn('Yes', { waitMs: 8000 });
    assert.match(done || '', /booked/, s.dump());
    const evs = s.since();
    assert.equal(dbCalls(evs, 'createAppointment').length, 1, 'one appointment row');
    assert.ok(dbCalls(evs, 'createAppointment')[0].args.idempotencyKey, 'C1 key reached the row args');
    assert.deepEqual(v1Calls(evs).map((e) => e.fn), [], 'no guardToolPlan / ensureRequired* / file gate / v1 turn');
    assert.ok(!s.mine().some((e) => e.ev === 'speak' && /EDITED BY V1 GATE/.test(e.text)), 'no v2 line was rewritten');
    const phases = dbCalls(evs, 'recordWriteReceipt').map((e) => e.args.phase);
    assert.deepEqual(phases.filter((p) => p !== 'rejected'), ['proposed', 'confirmed', 'committed']);
    await s.close();
  });

  it('end after goodbye: nothing more is said, one hangup; finishCall runs once even on reconnect and a second hangup', async () => {
    const callSid = 'HD_sim_c3_end';
    const s = await session(srv, callSid);
    await s.turn('What are your hours?');
    const bye = await s.turn("No thanks, that's all. Bye.", { settleMs: LINE_MS + 1500 });
    assert.match(bye, /goodbye|kwaheri/i, bye);
    const speaksBefore = s.mine().filter((e) => e.ev === 'speak').length;
    // The caller keeps talking while the hangup lands: no v1 path re-opens a turn.
    const late = await s.turn('Hello? Are you there?', { waitMs: 1500, settleMs: 300 });
    assert.equal(late, null, `nothing spoken after the goodbye, got: ${late}\n${s.dump()}`);
    assert.equal(s.mine().filter((e) => e.ev === 'speak').length, speaksBefore);
    await sleep(800);
    assert.ok(s.closed() && s.closed().code === 1000 && s.closed().reason === 'end_call', JSON.stringify(s.closed()));
    const hang = rest.hits.filter((h) => h.method === 'POST' && h.url === `/v1/calls/${callSid}/hangup`);
    assert.equal(hang.length, 1, 'one REST hangup');
    // Reconnect for the same call: the turn is dropped and no second finish runs.
    const again = await session(srv, callSid);
    const after = await again.turn('Hello?', { waitMs: 1500, settleMs: 300 });
    assert.equal(after, null, `a reconnect after v2 ended does not open a turn: ${after}`);
    await again.close();
    await sleep(500);
    const patches = dbCalls(srv.events, 'mergeCallSummaryMeta').filter((e) => e.args.callSid === callSid && e.args.patch && e.args.patch.brain_v2);
    assert.equal(patches.length, 1, `finishCall ran once: ${patches.length}`);
    assert.equal(patches[0].args.patch.brain_v2.ended_by_v2, true);
    assert.equal(patches[0].args.patch.brain_v2.outcome, 'answered');
    const finLogs = srv.events.filter((e) => e.ev === 'log' && e.line.includes(`brain_v2 finishCall ${callSid}`));
    assert.equal(finLogs.length, 1);
  });
});

describe('BRAIN_V2_OWNS_CALL unset: #849 behaviour (v1 fallthrough on a v2 throw)', () => {
  let srv;
  let rest;
  before(async () => {
    rest = await startFakeSautikit();
    srv = await startServer({ V2_SIM_THROW: 'SIMTHROW' }, rest.base);
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
    if (rest) rest.server.close();
  });

  it('a v2 throw falls through to the v1 path (logged), and no brain_v2 summary patch is written', async () => {
    const s = await session(srv, 'HD_sim_c3_off');
    await s.turn('SIMTHROW what are your hours', { waitMs: 4000 });
    assert.ok(s.mine().some((e) => e.ev === 'log' && /brain_v2_live failed, using v1/.test(e.line)));
    assert.ok(v1Calls(s.since()).length > 0, 'v1 ran');
    // Off, the v1 caller-file gate still sits on v2 lines (the sim gate rewrites what it sees).
    const heard = await s.turn('What are your hours?');
    assert.equal(heard, 'EDITED BY V1 GATE');
    await s.close();
    await sleep(500);
    assert.equal(dbCalls(srv.events, 'mergeCallSummaryMeta').filter((e) => e.args.patch && e.args.patch.brain_v2).length, 0);
  });
});
