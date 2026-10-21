// End-to-end: VOICE_OPENING_V2 through the real server.js media loop.
//
// Boots server.js in a child with tests/helpers/openingSim.js preloaded
// (mediaCallSim's fake Soniox STT/TTS + seeded greeting PCM cache, plus
// instant tenant/caller reads), opens real /ws/media sockets and drives STT
// events the way src/speech/sonioxStt.js emits them.
//
// Flag on: shop-language greeting from cache, greeting.first_pcm_ms <= 600,
// returning caller, bare Hello <= 2, silence ladder to hang-up, barge rules
// over the greeting, and a second stream for the same callSid plays no
// greeting. Flag off: today's opener, byte for byte, and no opening_* logs.
//
// Run: node --test tests/openingV2E2e.test.js   (Node 22, like CI)
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

describe('VOICE_OPENING_V2=on (e2e server.js)', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer({ VOICE_OPENING_V2: 'on', VOICE_OPENING_SILENCE_MS: '600,900,900' });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  it('first greet (sw shop): shop language, notice translated, no invite, cached, first PCM <= 600 ms', async () => {
    const sid = 'HD_sim_jirani_new_1';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.ok(g, 'greeting played');
    assert.match(g.line, /mode=opening_v2 kind=new_open lang=sw/);
    assert.ok(
      g.line.endsWith(': Hapa ni Jirani Cleaning Services, naitwa Wanjiru. Simu hii inaweza kurekodiwa. Nikusaidie vipi?'),
      g.line
    );
    assert.doesNotMatch(g.line, /English or Kiswahili|This call may be recorded|Good (morning|evening)/);
    const t = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[voice-timing][${sid}] greeting.first_pcm_ms=`), 5000);
    assert.ok(t, 'greeting.first_pcm_ms logged');
    const ms = Number(/first_pcm_ms=(\d+)/.exec(t.line)[1]);
    assert.match(t.line, /cached=1/);
    assert.ok(ms <= 600, `first PCM ${ms} ms`);
    await sleep(400);
    assert.ok(c.audio.length > 0, 'greeting PCM reached the caller socket');
    assert.equal(srv.events.filter((e) => e.ev === 'speak' && mine(sid)(e)).length, 0, 'cached greeting, not live TTS');
    c.ws.close();
  });

  it('Aris returning caller hears Karibu tena, no name, no notice', async () => {
    const sid = 'HD_sim_aris_ret_1';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.match(g.line, /kind=returning_open lang=sw/);
    assert.ok(g.line.endsWith(': Hapa ni Aris - The Home of Affordable Stationery, naitwa Lynn. Karibu tena. Tukusaidie vipi?'), g.line);
    assert.doesNotMatch(g.line, /Alvin|rekodi/);
    c.ws.close();
  });

  it('returning caller with a name confirmed on a past call hears the name once', async () => {
    const sid = 'HD_sim_esga_retnamed_1';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.ok(g.line.endsWith(': Hapa ni Esga, naitwa Lucy. Karibu tena, Alvin. Nikusaidie vipi?'), g.line);
    c.ws.close();
  });

  it('bare Hello: 2 re-invites in the shop language, never a 3rd, never silence', async () => {
    const sid = 'HD_sim_jirani_new_bare';
    const c = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(450);
    const heard = [];
    for (const [i, word] of ['Hello?', 'Halo', 'Hello.'].entries()) {
      const from = srv.events.length;
      sayFinal(srv, sid, word, { startMs: 9000 + i * 2000, endMs: 9400 + i * 2000 });
      const hit = await waitFor(
        srv.events,
        (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_line`) || (e.ev === 'speak' && mine(sid)(e)),
        1500,
        from
      );
      heard.push(hit ? (hit.ev === 'speak' ? `speak:${hit.text}` : hit.line.split(': ').slice(1).join(': ')) : null);
      await sleep(450);
    }
    const reinvites = logsOf(srv, sid).filter((l) => /bare_greeting_reinvite n=\d src=turn opening=v2/.test(l));
    assert.equal(reinvites.length, 2, reinvites.join('\n'));
    assert.equal(heard[0], 'Ndiyo, niko hapa. Nikusaidie vipi?');
    assert.equal(heard[1], 'Nakusikia. Nikusaidie vipi?');
    // Third bare Hello: no 3rd re-invite; the line is not silent (the
    // invite question is replayed or a normal turn speaks).
    // Third: no 3rd re-invite and no silence. Today's replay fallback asks the
    // question again (the invite, not the filler in front of it).
    assert.ok(heard[2], 'third bare Hello is not met with silence');
    assert.doesNotMatch(String(heard[2]), /niko hapa|Nakusikia/);
    assert.equal(heard[2], 'speak:Nikusaidie vipi?');
    c.ws.close();
  });

  it('silence ladder: invite, Halo? invite, goodbye, then the server hangs up (missed call)', async () => {
    const sid = 'HD_sim_jirani_new_silent';
    const c = await connect(srv, sid);
    await greetingLog(srv, sid);
    const end = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_silence_end missed_call=1`), 8000);
    assert.ok(end, 'silence end reached');
    const steps = logsOf(srv, sid).filter((l) => l.includes('opening_silence step='));
    assert.deepEqual(
      steps.map((l) => l.split('opening_silence ')[1]),
      [
        'step=1: Nikusaidie vipi?',
        'step=2: Halo? Nikusaidie vipi?',
        'step=3 goodbye: Sikusikii, kwa hivyo nitakata simu sasa. Karibu upige tena wakati wowote. Kwaheri.',
      ]
    );
    await waitFor(srv.events, () => Boolean(c.closed()), 3000);
    await sleep(100);
    assert.deepEqual(c.closed() && { code: c.closed().code, reason: c.closed().reason }, { code: 1000, reason: 'silence_end' });
  });

  it('caller speech resets the ladder; after a real turn it never fires', async () => {
    const sid = 'HD_sim_jirani_new_talk';
    const c = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(350);
    sayFinal(srv, sid, 'Nilikuwa nataka kujua bei ya deep clean ya vyumba viwili', { lang: 'sw' });
    await sleep(2600);
    assert.equal(logsOf(srv, sid).filter((l) => l.includes('opening_silence step=')).length, 0);
    assert.equal(c.closed(), null);
    c.ws.close();
  });

  it('first clear English turn at a Swahili shop switches the call to English', async () => {
    const sid = 'HD_sim_jirani_new_en';
    const c = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(350);
    sayFinal(srv, sid, 'Hi, how much do you charge to clean a two bedroom house?');
    const sw = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] lang.switch from=sw to=en first_turn=1`), 4000);
    assert.ok(sw, logsOf(srv, sid).join('\n'));
    c.ws.close();
  });

  it('a second stream for the same callSid plays no greeting (resume, listen)', async () => {
    const sid = 'HD_sim_jirani_new_resume';
    const a = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(500); // greeting done
    a.ws.terminate(); // abnormal drop, call not ended
    await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_socket_closed ended=0`), 3000);
    const from = srv.events.length;
    const b = await connect(srv, sid);
    const r = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_resume`), 5000, from);
    assert.ok(r, 'resume logged');
    assert.match(r.line, /stream_seq=2 action=listen/);
    await sleep(400);
    const after = logsOf(srv, sid, from);
    assert.equal(after.filter((l) => l.includes('greeting mode=')).length, 0, 'no greeting on the second stream');
    assert.equal(after.filter((l) => l.includes('connect_to_greeting_pcm_ms')).length, 0);
    b.ws.close();
  });
});

describe('VOICE_OPENING_V2=on, long greeting clip (barge rules, cut + resume)', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer({ VOICE_OPENING_V2: 'on', OPENING_SIM_PCM_MS: '3000', VOICE_OPENING_SILENCE_MS: '5000,10000,10000' });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  it('"mm" over the greeting does not barge; a real word does; the greeting is never replayed', async () => {
    const sid = 'HD_sim_jirani_new_barge';
    const c = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(700);
    sayInterim(srv, sid, 'mm', { startMs: 100, endMs: 300 });
    await sleep(300);
    assert.equal(logsOf(srv, sid).filter((l) => l.includes('opening_barge')).length, 0, 'mm does not barge');
    sayInterim(srv, sid, 'Mnafanya carpet cleaning', { startMs: 900, endMs: 1300, lang: 'sw' });
    const b = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_barge reason=real_word`), 2000);
    assert.ok(b, logsOf(srv, sid).join('\n'));
    await sleep(3200);
    assert.equal(logsOf(srv, sid).filter((l) => l.includes('greeting mode=')).length, 1, 'greeting played once');
    assert.equal(logsOf(srv, sid).filter((l) => l.includes('agent_question_replay')).length, 0, 'no replay after a barge');
    c.ws.close();
  });

  it('600 ms of caller speech barges even without a real word', async () => {
    const sid = 'HD_sim_jirani_new_barge600';
    const c = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(600);
    sayInterim(srv, sid, 'Hello hello', { startMs: 200, endMs: 500 });
    await sleep(200);
    assert.equal(logsOf(srv, sid).filter((l) => l.includes('opening_barge')).length, 0, '300 ms: no barge');
    sayInterim(srv, sid, 'Hello hello hello', { startMs: 200, endMs: 900 });
    const b = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_barge reason=speech_ms`), 2000);
    assert.ok(b, logsOf(srv, sid).join('\n'));
    c.ws.close();
  });

  it('drop mid-greeting: the new stream re-asks only the question, never the whole greeting', async () => {
    const sid = 'HD_sim_esga_new_cut';
    const a = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(800); // mid-way through the 3 s clip
    a.ws.terminate();
    await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_socket_closed ended=0 cut=1`), 3000);
    const from = srv.events.length;
    const b = await connect(srv, sid);
    const r = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_resume`), 5000, from);
    assert.match(r.line, /action=reinvite/);
    const line = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_line`), 3000, from);
    assert.ok(line.line.endsWith(': Nikusaidie vipi?'), line.line);
    assert.equal(logsOf(srv, sid, from).filter((l) => l.includes('greeting mode=')).length, 0);
    b.ws.close();
  });
});

describe('VOICE_OPENING_V2 unset: today exactly (e2e server.js)', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer({});
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  it("greets with today's composer line and logs nothing from the opening module", async () => {
    const sid = 'HD_sim_jirani_new_off';
    const { generateDynamicGreeting } = require('../src/conversation/dynamicSpeech');
    const { tenantProfileFromRow } = require('../src/tenantProfile');
    const { TENANTS } = require('./fixtures/openingTenants');
    const p = tenantProfileFromRow(TENANTS.jirani);
    const prevRec = process.env.VOICE_STREAM_RECORD;
    process.env.VOICE_STREAM_RECORD = 'on';
    const want = await generateDynamicGreeting({
      businessName: p.businessName,
      agentName: p.agentName,
      spokenName: p.spokenName,
      greetingInvite: p.greetingInvite,
      vertical: p.vertical,
      servicesCatalog: p.servicesCatalog,
      servicesOffered: p.servicesOffered,
      isOpen: true,
      afterHoursMode: 'serve',
      closureNotice: null,
      callerFileName: '',
      mode: 'instant',
    });
    if (prevRec == null) delete process.env.VOICE_STREAM_RECORD;
    else process.env.VOICE_STREAM_RECORD = prevRec;
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.match(g.line, /greeting mode=instant /);
    assert.ok(g.line.endsWith(`: ${want}`), `${g.line}\nwant: ${want}`);
    assert.match(want, /You can speak in English or Kiswahili/, 'today Jirani (home_services) carries the invite');
    await sleep(2500);
    const logs = logsOf(srv, sid);
    assert.equal(logs.filter((l) => /opening_|greeting\.first_pcm_ms|lang\.switch/.test(l)).length, 0, logs.join('\n'));
    c.ws.close();
  });

  it('flag off: a second stream for the same callSid greets again (today, #C6 bug kept)', async () => {
    const sid = 'HD_sim_jirani_new_offre';
    const a = await connect(srv, sid);
    await greetingLog(srv, sid);
    await sleep(500);
    a.ws.terminate();
    await sleep(300);
    const from = srv.events.length;
    const b = await connect(srv, sid);
    const g = await greetingLog(srv, sid, from);
    assert.ok(g, 'today: the reconnect greets again');
    b.ws.close();
  });
});
