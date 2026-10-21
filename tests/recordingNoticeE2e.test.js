// End-to-end: VOICE_RECORDING_NOTICE_VARIANT on the V2 opening, through the
// real server.js media loop (same harness as tests/openingV2E2e.test.js).
//
// Boots server.js in a child with tests/helpers/openingSim.js preloaded
// (mediaCallSim's fake Soniox STT/TTS + seeded greeting PCM cache, plus
// instant tenant/caller reads), opens real /ws/media sockets and drives STT
// events the way src/speech/sonioxStt.js emits them.
//
// The variant is spoken after the question, picked per callSid, kept on a
// reconnect, and each call logs whether the caller hung up within 5 s of the
// greeting end. Variant set with VOICE_OPENING_V2 off changes nothing.
'use strict';


const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const SIM = path.join(__dirname, 'helpers', 'openingSim.js');
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

function waitFor(events, pred, ms, from = 0) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const hit = events.slice(from).find(pred);
      if (hit) return resolve(hit);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(tick, 15);
    };
    tick();
  });
}

async function startServer(extraEnv = {}) {
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
    VOICE_STREAM_RECORD: 'on',
    ...extraEnv,
  };
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
  child.on('message', (m) => events.push({ ...m, t: Date.now() }));
  const ready = await waitFor(events, (e) => e.ev === 'log' && /Server listening on port/.test(e.line), 15000);
  if (!ready) {
    child.kill('SIGKILL');
    throw new Error(`server.js did not boot under the sim (Node 22 required):\n${stderr.slice(-2000)}`);
  }
  return { child, port, events };
}

const mine = (sid) => (e) => String(e.callSid || '') === sid || String(e.line || '').includes(`[${sid}]`);
const logsOf = (srv, sid, from = 0) =>
  srv.events.slice(from).filter((e) => e.ev === 'log' && mine(sid)(e)).map((e) => e.line);

/** Open a media socket for sid; resolves once open + start frame sent. */
async function connect(srv, sid) {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/media?callSid=${sid}`, 'audio.drachtio.org');
  const audio = [];
  let closed = null;
  ws.on('message', (data, isBinary) => {
    if (isBinary) audio.push(Date.now());
  });
  ws.on('close', (code, reason) => {
    closed = { code, reason: String(reason || ''), at: Date.now() };
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ event: 'start', metadata: { callSid: sid } }));
  return { ws, audio, closed: () => closed };
}

function greetingLog(srv, sid, from = 0) {
  return waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] greeting mode=`), 15000, from);
}

function sayFinal(srv, sid, text, { startMs = 9000, endMs = 9400, lang = 'en' } = {}) {
  const tokens = [{ text, final: true, start_ms: startMs, end_ms: endMs, language: lang }];
  srv.child.send({ cmd: 'stt', callSid: sid, evt: { type: 'transcript', text, isFinal: true, tokens, tokenLanguages: [lang] } });
  srv.child.send({ cmd: 'stt', callSid: sid, evt: { type: 'endpoint', tokens: [] } });
}

function sayInterim(srv, sid, text, { startMs, endMs, lang = 'en' }) {
  const tokens = [{ text, final: false, start_ms: startMs, end_ms: endMs, language: lang }];
  srv.child.send({ cmd: 'stt', callSid: sid, evt: { type: 'transcript', text, isFinal: false, tokens } });
}


const rnv = require('../src/speech/recordingNoticeVariant');

describe('VOICE_RECORDING_NOTICE_VARIANT=a (V2 on)', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer({
      VOICE_OPENING_V2: 'on',
      VOICE_RECORDING_NOTICE_VARIANT: 'a',
      VOICE_OPENING_SILENCE_MS: '60000,60000,60000',
    });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  it('greets, asks, then the reason-led notice; caller hang-up at ~1 s is early', async () => {
    const sid = 'HD_sim_jirani_new_rna';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.ok(
      g.line.endsWith(': Hapa ni Jirani Cleaning Services, naitwa Wanjiru. Nikusaidie vipi? Na kwa ubora wa huduma, tunarekodi simu.'),
      g.line
    );
    const v = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice variant=a lang=sw`), 3000);
    assert.ok(v);
    await sleep(1000);
    c.ws.close(1000, 'caller_hangup');
    const out = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice_outcome`), 3000);
    assert.ok(out, logsOf(srv, sid).join('\n'));
    assert.match(out.line, /variant=a early_hangup=1 since_greeting_end_ms=\d+ by_agent=0 notice_cut=0/);
  });

  it('a caller who stays past 5 s is not early', async () => {
    const sid = 'HD_sim_esga_new_rnstay';
    const c = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(5800);
    c.ws.close(1000, 'caller_hangup');
    const out = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice_outcome`), 3000);
    assert.match(out.line, /variant=a early_hangup=0 since_greeting_end_ms=(\d+)/);
    assert.ok(Number(/since_greeting_end_ms=(\d+)/.exec(out.line)[1]) > 5000);
  });

  it('returning caller: no notice, no variant, no outcome', async () => {
    const sid = 'HD_sim_aris_ret_rn';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.doesNotMatch(g.line, /rekodi|record/i);
    await sleep(300);
    c.ws.close(1000);
    await sleep(500);
    assert.equal(logsOf(srv, sid).filter((l) => l.includes('recording_notice')).length, 0);
  });

  it('a reconnect keeps the variant and logs one outcome at the real end', async () => {
    const sid = 'HD_sim_jirani_new_rnre';
    const a = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(400);
    a.ws.terminate();
    await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_socket_closed ended=0`), 3000);
    assert.equal(logsOf(srv, sid).filter((l) => l.includes('recording_notice_outcome')).length, 0, 'a drop is not a hang-up');
    const b = await connect(srv, sid);
    await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_resume`), 3000);
    await sleep(300);
    b.ws.close(1000);
    const out = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice_outcome`), 3000);
    assert.match(out.line, /variant=a /);
    const logs = logsOf(srv, sid);
    assert.equal(logs.filter((l) => /recording_notice variant=/.test(l)).length, 1);
    assert.equal(logs.filter((l) => l.includes('recording_notice_outcome')).length, 1);
  });
});

describe('VOICE_RECORDING_NOTICE_VARIANT=a,b,c (V2 on): per-call pick, agent hang-up', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer({
      VOICE_OPENING_V2: 'on',
      VOICE_RECORDING_NOTICE_VARIANT: 'a,b,c',
      VOICE_OPENING_SILENCE_MS: '300,500,500',
    });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  it('each call speaks the wording its callSid hashes to; silence end is by the agent, never early', async () => {
    const env = { VOICE_RECORDING_NOTICE_VARIANT: 'a,b,c' };
    const seen = new Set();
    const sids = [];
    for (let i = 0; seen.size < 3 && i < 50; i += 1) {
      const sid = `HD_sim_esga_new_pick${i}`;
      const v = rnv.pickNoticeVariant(sid, env);
      if (seen.has(v)) continue;
      seen.add(v);
      sids.push([sid, v]);
    }
    assert.equal(sids.length, 3);
    await Promise.all(
      sids.map(async ([sid, v]) => {
        const c = await connect(srv, sid);
        const g = await greetingLog(srv, sid);
        assert.ok(g.line.endsWith(`Nikusaidie vipi? ${rnv.WORDINGS.sw[v]}`), g.line);
        const out = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice_outcome`), 8000);
        assert.ok(out, logsOf(srv, sid).join('\n'));
        assert.match(out.line, new RegExp(`variant=${v} early_hangup=0 .*by_agent=1`));
        assert.equal(c.closed() && c.closed().reason, 'silence_end');
      })
    );
  });
});

describe('VOICE_RECORDING_NOTICE_VARIANT set, VOICE_OPENING_V2 off', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer({ VOICE_RECORDING_NOTICE_VARIANT: 'a' });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  it("today's greeting, no variant, and a boot warning", async () => {
    const sid = 'HD_sim_jirani_new_rnoff';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.match(g.line, /greeting mode=instant /);
    assert.doesNotMatch(g.line, /ubora wa huduma|service quality/);
    assert.ok(srv.events.some((e) => e.ev === 'log' && /VOICE_RECORDING_NOTICE_VARIANT is set but VOICE_OPENING_V2 is off/.test(e.line)));
    await sleep(300);
    c.ws.close(1000);
    await sleep(400);
    assert.equal(logsOf(srv, sid).filter((l) => l.includes('recording_notice')).length, 0);
  });
});
