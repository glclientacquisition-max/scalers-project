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
const fs = require('node:fs');
const os = require('node:os');
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

  it('Aris returning caller hears Karibu tena, no name, and the short notice (KDPA default)', async () => {
    const sid = 'HD_sim_aris_ret_1';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.match(g.line, /kind=returning_open lang=sw/);
    assert.ok(
      g.line.endsWith(': Hapa ni Aris - The Home of Affordable Stationery, naitwa Lynn. Karibu tena. Simu hii inaweza kurekodiwa. Tukusaidie vipi?'),
      g.line
    );
    assert.doesNotMatch(g.line, /Alvin/);
    c.ws.close();
  });

  it('returning caller with a name confirmed on a past call hears the name once', async () => {
    const sid = 'HD_sim_esga_retnamed_1';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.ok(g.line.endsWith(': Hapa ni Esga, naitwa Lucy. Karibu tena, Alvin. Simu hii inaweza kurekodiwa. Nikusaidie vipi?'), g.line);
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

describe('VOICE_RETURNING_SKIP_NOTICE=on: returning callers skip the notice (e2e)', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer({ VOICE_OPENING_V2: 'on', VOICE_RETURNING_SKIP_NOTICE: 'on', VOICE_OPENING_SILENCE_MS: '60000,60000,60000' });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  it('returning caller: no notice; notice_given=false how=skipped_returning logged', async () => {
    const sid = 'HD_sim_aris_ret_skip';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.ok(g.line.endsWith(': Hapa ni Aris - The Home of Affordable Stationery, naitwa Lynn. Karibu tena. Tukusaidie vipi?'), g.line);
    assert.doesNotMatch(g.line, /rekodi/);
    await sleep(500);
    c.ws.close();
    const n = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice_given `), 3000);
    assert.ok(n, logsOf(srv, sid).join('\n'));
    assert.match(n.line, /given=false .*state=not_required/);
  });

  it('a new caller still hears the notice with the flag on', async () => {
    const sid = 'HD_sim_aris_new_skip';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.match(g.line, /Simu hii inaweza kurekodiwa\./);
    c.ws.close();
  });
});

describe('returning caller greeted in contacts.last_language (#844, contacts probe on)', { concurrency: true }, () => {
  let srv;
  let dir;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opening-lang-'));
    srv = await startServer({
      VOICE_OPENING_V2: 'on',
      OPENING_SIM_SHARED_DIR: dir,
      OPENING_SIM_LAST_LANGUAGE: 'en',
      VOICE_OPENING_SILENCE_MS: '60000,60000,60000',
    });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Swahili shop, caller last spoke English: English greeting, notice and question; the owner text is not used', async () => {
    const sid = 'HD_sim_jirani_ret_en';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.match(g.line, /kind=returning_open lang=en/);
    assert.match(g.line, /Welcome back\. This call may be recorded\. How can I help\?$/);
    assert.doesNotMatch(g.line, /Karibu|rekodi|Nikusaidie/);
    assert.ok(logsOf(srv, sid).some((l) => l.includes('opening_lang caller_last=en shop=sw')));
    c.ws.close();
  });

  it('a new caller at the same shop is greeted in the shop language', async () => {
    // (contacts probe off: see the next describe)
    const sid = 'HD_sim_jirani_new_lang';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.match(g.line, /kind=new_open lang=sw/);
    c.ws.close();
  });
});

describe('contacts probe off: last_language is neither read nor written', { concurrency: true }, () => {
  let srv;
  let dir;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opening-nolang-'));
    srv = await startServer({
      VOICE_OPENING_V2: 'on',
      OPENING_SIM_SHARED_DIR: dir,
      OPENING_SIM_SHARED_PROBE: 'calls',
      OPENING_SIM_LAST_LANGUAGE: 'en',
      VOICE_OPENING_SILENCE_MS: '60000,60000,60000',
    });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('card says en, contacts off: shop language (sw), no opening_lang line', async () => {
    const sid = 'HD_sim_jirani_ret_nolang';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.match(g.line, /kind=returning_open lang=sw/);
    assert.equal(logsOf(srv, sid).filter((l) => l.includes('opening_lang')).length, 0);
    c.ws.close();
  });
});

// KDPA ruling: a barge that cuts the recording notice leaves it owed; the
// agent says it in one short line before the first personal-details ask or
// save, whichever comes first. A fake Gemini scripts the agent's turns.
describe('KDPA: notice cut by a barge is given before the name ask / save (e2e)', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer({
      VOICE_OPENING_V2: 'on',
      OPENING_SIM_PCM_MS: '3000',
      VOICE_OPENING_SILENCE_MS: '60000,60000,60000',
      GEMINI_API_KEY: 'sim-not-a-key',
      OPENING_SIM_GEMINI_SCRIPT: JSON.stringify([
        ['zulia', 'Sawa, tunaweza kusafisha zulia. Naomba jina lako?'],
        ['naitwa peter', 'Asante Peter. ###TOOL###{"save_caller_info":{"name":"Peter","reason":"carpet cleaning"}}###ENDTOOL###'],
        ['bei', 'Bei inategemea ukubwa wa nyumba.'],
      ]),
    });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  async function bargeEarly(sid) {
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.match(g.line, /Simu hii inaweza kurekodiwa\./);
    await sleep(600);
    sayInterim(srv, sid, 'Mnafanya carpet cleaning', { startMs: 500, endMs: 900, lang: 'sw' });
    const cut = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice cut `), 2000);
    assert.ok(cut, logsOf(srv, sid).join('\n'));
    assert.match(cut.line, /-> owed/);
    await sleep(300);
    return c;
  }

  it('barge cuts the notice; the name ask carries it in one line first', async () => {
    const sid = 'HD_sim_jirani_new_kdpa1';
    const c = await bargeEarly(sid);
    const from = srv.events.length;
    sayFinal(srv, sid, 'Mnasafisha zulia?', { lang: 'sw' });
    const ask = await waitFor(srv.events, (e) => e.ev === 'speak' && mine(sid)(e) && /jina/i.test(e.text), 6000, from);
    assert.ok(ask, `${logsOf(srv, sid, from).join('\n')}`);
    const spoken = srv.events.slice(from).filter((e) => e.ev === 'speak' && mine(sid)(e)).map((e) => e.text).join(' ');
    const at = spoken.indexOf('Simu hii inaweza kurekodiwa.');
    assert.ok(at >= 0 && at < spoken.search(/Naomba jina/i), spoken);
    assert.ok(logsOf(srv, sid).some((l) => /recording_notice given how=before_ask ask=name/.test(l)));
    c.ws.close();
    const n = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice_given `), 3000);
    assert.match(n.line, /given=true how=before_ask at_ms=\d+ cut_at_ms=\d+ state=given/);
  });

  it('barge cuts the notice; a save comes first: the notice is spoken before the save runs', async () => {
    const sid = 'HD_sim_jirani_new_kdpa2';
    const c = await bargeEarly(sid);
    const from = srv.events.length;
    sayFinal(srv, sid, 'Naitwa Peter, nataka carpet cleaning', { lang: 'sw' });
    const given = await waitFor(
      srv.events,
      (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice given how=before_save`),
      5000,
      from
    );
    assert.ok(given, logsOf(srv, sid, from).join('\n'));
    const save = await waitFor(srv.events, (e) => e.ev === 'db_write' && e.fn === 'saveCallerInfo' && e.callSid === sid, 3000, from);
    assert.ok(save, 'save ran (sim stub, no database)');
    const noticeSpeak = srv.events.slice(from).find((e) => e.ev === 'speak' && mine(sid)(e) && /Simu hii inaweza kurekodiwa/.test(e.text));
    assert.ok(noticeSpeak, 'notice spoken');
    assert.ok(srv.events.indexOf(noticeSpeak) < srv.events.indexOf(save), 'notice spoken before the save');
    const turn = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[voice-timing][${sid}] turn_ms=`), 3000, from);
    assert.ok(turn && Number(/turn_ms=(\d+)/.exec(turn.line)[1]) < 1500, `the gate must not stall the turn: ${turn && turn.line}`);
    c.ws.close();
  });

  it('a turn with no ask and no save does not spend the owed notice', async () => {
    const sid = 'HD_sim_jirani_new_kdpa3';
    const c = await bargeEarly(sid);
    const from = srv.events.length;
    sayFinal(srv, sid, 'Bei ni ngapi?', { lang: 'sw' });
    await waitFor(srv.events, (e) => e.ev === 'speak' && mine(sid)(e), 6000, from);
    await sleep(300);
    const spoken = srv.events.slice(from).filter((e) => e.ev === 'speak' && mine(sid)(e)).map((e) => e.text).join(' ');
    assert.doesNotMatch(spoken, /rekodi/);
    c.ws.close();
    const n = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] recording_notice_given `), 3000);
    assert.match(n.line, /given=false .*state=owed/);
  });
});

// Latency ruling: the incoming-call webhook loads the tenant profile (and
// warms the greeting PCM) keyed by callSid before the stream opens.
describe('webhook prefetch: 2.5 s profile load, cache hit greets under 600 ms (e2e)', { concurrency: true }, () => {
  let srv;
  before(async () => {
    srv = await startServer({ VOICE_OPENING_V2: 'on', OPENING_SIM_PROFILE_DELAY_MS: '2500', VOICE_OPENING_SILENCE_MS: '60000,60000,60000' });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  async function webhook(sid, did = '+254709000003', from = '+254700000001') {
    const r = await fetch(`http://127.0.0.1:${srv.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, callerNumber: from, destinationNumber: did, isActive: true, direction: 'inbound' }),
    });
    assert.equal(r.status, 200);
    return r.text();
  }
  const firstPcm = async (sid) => {
    const t = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[voice-timing][${sid}] greeting.first_pcm_ms=`), 8000);
    assert.ok(t, logsOf(srv, sid).join('\n'));
    return { ms: Number(/first_pcm_ms=(\d+)/.exec(t.line)[1]), line: t.line };
  };

  it('hit: webhook then stream -> first PCM < 600 ms, prefetch=hit, profile read once', async () => {
    const sid = 'HD_sim_jirani_new_pfhit';
    await webhook(sid);
    const ready = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[${sid}] opening_prefetch ready`), 5000);
    assert.ok(ready, logsOf(srv, sid).join('\n'));
    const c = await connect(srv, sid);
    const t = await firstPcm(sid);
    assert.match(t.line, /prefetch=hit/);
    assert.match(t.line, /cached=1/);
    assert.ok(t.ms < 600, `first PCM ${t.ms} ms`);
    c.ws.close();
  });

  it('miss: stream with no webhook falls back to today\'s load (slow, still greets)', async () => {
    const sid = 'HD_sim_jirani_new_pfmiss';
    const c = await connect(srv, sid);
    const t = await firstPcm(sid);
    assert.match(t.line, /prefetch=miss/);
    assert.ok(t.ms >= 2400, `miss should pay the 2.5 s load, got ${t.ms} ms`);
    c.ws.close();
  });

  it('in flight: stream opens 1 s after the webhook -> waits for the same load, no second read', async () => {
    const sid = 'HD_sim_esga_new_pfwait';
    await webhook(sid, '+254709000002');
    await sleep(1000);
    const c = await connect(srv, sid);
    const t = await firstPcm(sid);
    assert.match(t.line, /prefetch=inflight/);
    assert.ok(t.ms < 2400, `in-flight prefetch should save ~1 s, got ${t.ms} ms`);
    c.ws.close();
  });
});

// Shared resume ruling: two replicas share Platform's calls helpers (#844,
// mocked on files here; no database is written). The markCallGreeted claim
// decides who greets.
describe('two replicas share the opening store: a reconnect on B does not greet (e2e)', { concurrency: false }, () => {
  let a;
  let b;
  let dir;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opening-shared-'));
    const env = { VOICE_OPENING_V2: 'on', OPENING_SIM_SHARED_DIR: dir, VOICE_OPENING_SILENCE_MS: '60000,60000,60000' };
    [a, b] = await Promise.all([startServer(env), startServer(env)]);
  });
  after(() => {
    for (const s of [a, b]) if (s) s.child.kill('SIGKILL');
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('both replicas detect the helpers once and use them', async () => {
    for (const s of [a, b]) {
      const on = await waitFor(s.events, (e) => e.ev === 'log' && e.line.includes('[opening-store]'), 3000);
      assert.ok(on, 'opening-store logged');
      assert.match(on.line, /shared resume on/);
      assert.equal(s.events.filter((e) => e.ev === 'log' && e.line.includes('[opening-store]')).length, 1);
    }
  });

  it('greet on A, drop, reconnect on B: claim lost, resume (listen), no greeting on B', async () => {
    const sid = 'HD_sim_jirani_new_2rep';
    const c1 = await connect(a, sid);
    const g = await greetingLog(a, sid);
    assert.ok(g, 'A greets');
    assert.ok(logsOf(a, sid).some((l) => l.includes('opening_claim won store=db')), logsOf(a, sid).join('\n'));
    await sleep(500);
    c1.ws.terminate();
    await waitFor(a.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_socket_closed ended=0`), 3000);
    const c2 = await connect(b, sid);
    const lost = await waitFor(b.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_claim lost store=db -> resume action=listen`), 5000);
    assert.ok(lost, logsOf(b, sid).join('\n'));
    await sleep(600);
    const bLogs = logsOf(b, sid);
    assert.equal(bLogs.filter((l) => l.includes('greeting mode=')).length, 0, bLogs.join('\n'));
    assert.equal(b.events.filter((e) => e.ev === 'speak' && mine(sid)(e)).length, 0, 'B spoke nothing');
    assert.ok(bLogs.some((l) => /opening_resume .*action=listen/.test(l)), bLogs.join('\n'));
    const row = JSON.parse(fs.readFileSync(path.join(dir, `${sid}.json`), 'utf8'));
    assert.ok(row.greeted_at);
    assert.equal(row.stream_seq, 2);
    c2.ws.close();
  });

  it('a different call on B still greets (wins its own claim)', async () => {
    const sid = 'HD_sim_esga_new_2rep';
    const c = await connect(b, sid);
    const g = await greetingLog(b, sid);
    assert.ok(g, 'B greets a new call');
    c.ws.close();
  });
});

// Platform's next #844 push: markCallNoticeGiven and calls.last_line_cut,
// mocked on files (no database). Notice heard on A is not repeated on B; a
// greeting cut on A is re-asked once on B, then B listens.
describe('two replicas: notice given and cut line carry across (mocked #844 next push)', { concurrency: false }, () => {
  let a;
  let b;
  let dir;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opening-carry-'));
    const env = {
      VOICE_OPENING_V2: 'on',
      OPENING_SIM_SHARED_DIR: dir,
      OPENING_SIM_PCM_MS: '1500',
      VOICE_OPENING_SILENCE_MS: '60000,60000,60000',
      GEMINI_API_KEY: 'sim-not-a-key',
      OPENING_SIM_GEMINI_SCRIPT: JSON.stringify([['zulia', 'Sawa, tunaweza kusafisha zulia. Naomba jina lako?']]),
    };
    [a, b] = await Promise.all([startServer(env), startServer(env)]);
  });
  after(() => {
    for (const s of [a, b]) if (s) s.child.kill('SIGKILL');
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });
  const row = (sid) => JSON.parse(fs.readFileSync(path.join(dir, `${sid}.json`), 'utf8'));

  it('notice heard on A (markCallNoticeGiven) -> B resumes and the name ask carries no notice', async () => {
    const sid = 'HD_sim_jirani_new_carry1';
    const c1 = await connect(a, sid);
    await greetingLog(a, sid);
    const marked = await waitFor(a.events, (e) => e.ev === 'db_helper' && e.fn === 'markCallNoticeGiven' && e.callSid === sid, 4000);
    assert.ok(marked, logsOf(a, sid).join('\n'));
    assert.equal(row(sid).notice_given, true);
    assert.equal(a.events.filter((e) => e.ev === 'db_helper' && e.fn === 'markCallNoticeGiven' && e.callSid === sid).length, 1, 'once');
    c1.ws.terminate();
    await waitFor(a.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_socket_closed ended=0`), 3000);
    const c2 = await connect(b, sid);
    const lost = await waitFor(b.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_claim lost`), 5000);
    assert.ok(lost, logsOf(b, sid).join('\n'));
    await sleep(300);
    const from = b.events.length;
    sayFinal(b, sid, 'Mnasafisha zulia?', { lang: 'sw' });
    const ask = await waitFor(b.events, (e) => e.ev === 'speak' && mine(sid)(e) && /jina/i.test(e.text), 6000, from);
    assert.ok(ask, logsOf(b, sid, from).join('\n'));
    const spoken = b.events.slice(from).filter((e) => e.ev === 'speak' && mine(sid)(e)).map((e) => e.text).join(' ');
    assert.doesNotMatch(spoken, /rekodi/, 'B owes no notice');
    assert.equal(logsOf(b, sid).filter((l) => l.includes('recording_notice given')).length, 0);
    c2.ws.close();
  });

  it('greeting cut on A by a socket loss -> B re-asks only the question once; a second drop on B -> listen', async () => {
    const sid = 'HD_sim_esga_new_carry2';
    const c1 = await connect(a, sid);
    await greetingLog(a, sid);
    await sleep(400); // mid-way through the 1.5 s clip
    c1.ws.terminate();
    await waitFor(a.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_socket_closed ended=0 cut=1`), 3000);
    const cutWrite = await waitFor(a.events, (e) => e.ev === 'db_helper' && e.fn === 'updateLastAgentLine' && e.callSid === sid && e.cut === true, 3000);
    assert.ok(cutWrite, 'updateLastAgentLine(..., {cut:true})');
    assert.equal(row(sid).last_line_cut, true);
    const c2 = await connect(b, sid);
    const r = await waitFor(b.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_resume`), 5000);
    assert.match(r.line, /action=reinvite/);
    const line = await waitFor(b.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_line`), 3000);
    assert.ok(line.line.endsWith(': Nikusaidie vipi?'), line.line);
    assert.equal(logsOf(b, sid).filter((l) => l.includes('greeting mode=')).length, 0);
    await sleep(400);
    assert.equal(row(sid).last_line_cut, false, 'the re-said line clears the cut');
    await sleep(1500); // let the 1.5 s re-ask clip finish: this drop cuts nothing
    c2.ws.terminate();
    const closed = await waitFor(b.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_socket_closed ended=0 cut=0`), 3000);
    assert.ok(closed, logsOf(b, sid).join('\n'));
    const from = b.events.length;
    const c3 = await connect(b, sid);
    const r2 = await waitFor(b.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_resume`), 5000, from);
    assert.match(r2.line, /action=listen/);
    await sleep(300);
    assert.equal(logsOf(b, sid, from).filter((l) => l.includes('opening_line')).length, 0, 're-said once only');
    c3.ws.close();
  });
});

// #843 alone (no #842 end-call controller in this tree): the silence goodbye
// keeps its own timed close even with VOICE_END_CALL_HONOUR=on. With #842 in
// the tree, tests/openingEndCallE2e.test.js covers the controller path.
const HAS_842 = fs.existsSync(path.join(ROOT, 'src/speech/endCallHonour.js'));
describe('silence goodbye without #842: close path unchanged even with VOICE_END_CALL_HONOUR=on', { skip: HAS_842 ? '#842 is in this tree (see openingEndCallE2e)' : false }, () => {
  let srv;
  before(async () => {
    srv = await startServer({ VOICE_OPENING_V2: 'on', VOICE_END_CALL_HONOUR: 'on', VOICE_OPENING_SILENCE_MS: '600,900,900' });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
  });

  it('goodbye, then ws.close(1000, silence_end) on the byte timer', async () => {
    const sid = 'HD_sim_jirani_silent_alone';
    const c = await connect(srv, sid);
    await greetingLog(srv, sid);
    const end = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes(`[ws/media][${sid}] opening_silence_end missed_call=1`), 8000);
    assert.ok(end, 'silence end reached');
    assert.match(end.line, /hangup in \d+ms/);
    await waitFor(srv.events, () => Boolean(c.closed()), 3000);
    await sleep(100);
    assert.deepEqual(c.closed() && { code: c.closed().code, reason: c.closed().reason }, { code: 1000, reason: 'silence_end' });
    assert.ok(!logsOf(srv, sid).some((l) => l.includes('end_call')));
  });
});

describe('current #844 (no probeGreetingSchema): memory, one warning, no helper called', () => {
  let srv;
  let dir;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opening-cur-'));
    srv = await startServer({ VOICE_OPENING_V2: 'on', OPENING_SIM_SHARED_DIR: dir, OPENING_SIM_SHARED_PROBE: 'absent', VOICE_OPENING_SILENCE_MS: '60000,60000,60000' });
  });
  after(() => {
    if (srv) srv.child.kill('SIGKILL');
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('greets from memory; no #844 helper is called', async () => {
    const warn = await waitFor(srv.events, (e) => e.ev === 'log' && e.line.includes('[opening-store]'), 3000);
    assert.match(warn.line, /probeGreetingSchema not found/);
    const sid = 'HD_sim_aris_new_cur';
    const c = await connect(srv, sid);
    const g = await greetingLog(srv, sid);
    assert.ok(g);
    assert.ok(logsOf(srv, sid).some((l) => l.includes('opening_claim won store=memory')));
    await sleep(300);
    c.ws.close();
    await sleep(200);
    assert.equal(srv.events.filter((e) => e.ev === 'db_helper').length, 0);
  });
});
