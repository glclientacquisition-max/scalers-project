'use strict';
// BRAIN_V2_NLU_GAPS (default off): nlu-gap-spec.md sections 0-6, plus the confidence fields
// (kind, confidence 0-1, clear, reason) every understand() call returns. EN and SW per gap.
const test = require('node:test');
const assert = require('node:assert');
const N = require('../src/conversation/v2/nlu');
const G = require('../src/conversation/v2/intentGate');
const SC = require('../src/knowledge/spokenCatalogue');
const V2 = require('../src/conversation/v2');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const RS = require('../evals/v2/fixtures/tenants/retail_shop.json');
const NOW = new Date('2026-10-14T05:00:00Z');
const DOC = SC.compileSync(DD);
const on = { gaps: true };
const u = (t, o = {}) => N.understand(t, { profile: DD, now: NOW, ...on, ...o });
const gate = (t, o = {}) => G.nluIntent(t, { profile: DD, doc: DOC, now: NOW, ...on, ...o });
const SVC = { carpet: 'svc_4dc611dcf0e74b71', window: 'svc_bf7babf2e7584f74', house3: 'svc_f741700dab2d4075', mattress: 'svc_91d79a138bb84c0b', oneBed: 'svc_2617945721b64794' };

test('confidence: every read carries kind, confidence 0-1, clear and reason (flag off too)', () => {
  for (const t of ['How much is carpet cleaning?', 'Ndio', 'hmm', 'What services do you offer?', 'Saa nne kesho', 'Bei gani?']) {
    for (const gaps of [false, true]) {
      const r = N.understand(t, { profile: DD, now: NOW, gaps });
      assert.equal(typeof r.kind, 'string', t); assert.equal(typeof r.reason, 'string', t); assert.equal(typeof r.clear, 'boolean', t);
      assert.ok(r.confidence >= 0 && r.confidence <= 1, t);
    }
  }
  assert.deepEqual([u('How much is carpet cleaning?').kind, u('How much is carpet cleaning?').clear], ['price_service', true]);
  assert.deepEqual([u('Bei gani?').kind, u('Bei gani?').clear, u('Bei gani?').reason], ['price_service', false, 'no_service_id']);
  assert.equal(u('hmm').clear, false);
  const g = gate('How much is carpet cleaning?'); assert.equal(g.confidence, 'high'); assert.equal(g.clear, true); assert.ok(g.score >= 0.8);
});

test('flag off: gap phrasings read exactly as before', () => {
  for (const t of ['What else can you do?', 'Mpaka carpet?', 'Carpet mnadhanioshea?']) assert.deepEqual(N.understand(t, { profile: DD, now: NOW, gaps: false }).intents, [], t);
});

test('§0 ASR normaliser: fillers and known mishears', () => {
  assert.equal(N.normaliseAsr('And do you guys like clean windows?'), 'And do you clean windows?');
  assert.equal(N.normaliseAsr("I'd like to know"), "I'd like to know");
  assert.match(N.normaliseAsr('this is one back room joining'), /cleaning services/);
  assert.match(N.normaliseAsr('Carpet mnadhanioshea?'), /mnaosha/);
  assert.match(N.normaliseAsr('mnafanya usasi gani'), /usafi/);
});

test('§1 which-services: EN', () => {
  for (const t of ['What else can you do?', 'what else do you offer', 'which cleaning services do you have', 'what kind of services you offer', 'I wanted to know which service is you offer.', 'Uh, this is one back room joining. Which cleaning services can you mnafanya?'])
    assert.equal(gate(t).intent, 'list_services', t);
});
test('§1 which-services: SW', () => {
  for (const t of ['mnafanya nini tena', 'nini zingine mnafanya', 'huduma gani mnapeana', 'mko na usafi gani', 'Gani mnapenda?', 'Mko— mko na stationary gani inasaidia watu wa engineering kuchora?'])
    assert.equal(gate(t).intent, 'list_services', t);
  assert.equal(gate('And what else can you do? Can— how much is cleaning for For.').intent, 'price_service'); // price stays primary
});

test('§2 Rule A (pending price): EN and SW', () => {
  const prev = { kind: 'price_service', service: null };
  for (const [t, id] of [['For carpet cleaning?', SVC.carpet], ['For a 3-bedroom— 3-bedroom apartment?', SVC.house3], ['like carpet cleaning?', SVC.carpet], ['ya carpet?', SVC.carpet], ['kwa godoro je?', SVC.mattress]]) {
    const g = gate(t, { prev }); assert.equal(g.intent, 'price_service', t); assert.equal(g.service_id, id, t); assert.equal(g.confidence, 'high', t);
  }
  assert.equal(gate('For carpet cleaning?').intent, 'other'); // no pending price: no rule
});
test('§2 Rule B (price echo): EN and SW', () => {
  const window = DD.servicesCatalog.find((s) => s.id === SVC.window);
  const prev = { kind: 'price_service', service: window };
  for (const t of ['only 200?', 'is it really 1500 shillings?', 'Wallahi, ni 200 shillings peke yake?', 'ni elfu moja tu?']) {
    const g = gate(t, { prev }); assert.equal(g.intent, 'price_service', t); assert.equal(g.service_id, SVC.window, t);
  }
});

test('§3 explain phrasings and GENERIC binding: EN and SW', () => {
  for (const t of ['tell me more about carpet cleaning', "what's included in the sofa one", 'remind me the carpet details', 'Eeh, Carpet Cleaning. Could you remind me, like, like accurately, what Carpet Cleaning details were we']) assert.equal(gate(t).intent, 'explain_service', t);
  assert.equal(gate('remind me the carpet details').service_id, SVC.carpet);
  for (const t of ['nieleze carpet cleaning', 'maelezo ya godoro']) { const g = gate(t); assert.equal(g.intent, 'explain_service', t); assert.equal(g.confidence, 'high', t); }
  // two apartment items: never guessed, sent to the model / a short clarify
  const amb = u('Hebu niambie kuhusu hiyo usafi wa apartment');
  assert.equal(amb.kind, 'explain_service'); assert.equal(amb.service, null); assert.equal(amb.serviceCandidates.length, 2); assert.equal(amb.reason, 'service_ambiguous');
  const one = { servicesCatalog: [{ id: 'svc_a', name: 'Apartment Cleaning' }, { id: 'svc_b', name: 'Sofa Cleaning' }] };
  assert.equal(N.understand('niambie kuhusu usafi wa apartment', { profile: one, now: NOW, gaps: true }).service.id, 'svc_a');
});

test('§4 service check: EN and SW', () => {
  for (const [t, id] of [['do you clean windows?', SVC.window], ['And do you guys like clean windows?', SVC.window], ['do you also do carpets?', SVC.carpet], ['even carpets?', SVC.carpet], ['mnaosha carpet?', SVC.carpet], ['Mpaka carpet?', SVC.carpet], ['mnasafisha madirisha?', SVC.window], ['godoro mnaosha?', SVC.mattress], ['Carpet mnadhanioshea?', SVC.carpet]]) {
    const r = u(t); assert.equal(r.kind, 'check_service', t);
    const g = gate(t); assert.equal(g.intent, 'explain_service', t); assert.equal(g.service_id, id, t); assert.equal(g.confidence, 'high', t);
  }
  assert.equal(gate('do you clean spaceships?').intent, 'list_services'); // no catalogue hit: not a check
});
test('§4 machine answers a service check from the catalogue (EN, SW)', async () => {
  for (const t of ['do you guys like clean windows?', 'mnaosha carpet?']) {
    process.env.BRAIN_V2_NLU_GAPS = '1';
    try { const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] }); const r = await V2.runTurn(st, { text: t, profile: DD, now: NOW, handlers: {} }); assert.match(r.line, /window|carpet/i, t); assert.doesNotMatch(r.line, /How can I help/, t); } finally { delete process.env.BRAIN_V2_NLU_GAPS; }
  }
});

test('§5 "Wewe niambie" in a services topic; 89aa T4 stays explain', () => {
  for (const t of ['Wewe niambie.', 'niambie', 'you tell me', 'just tell me']) { const g = gate(t, { topic: 'services' }); assert.equal(g.intent, 'list_services', t); assert.equal(g.confidence, 'high', t); }
  assert.equal(gate('Wewe niambie.').confidence, 'low'); // no topic: not confident
  const g = gate("I don't understand what you're saying by 1-Bedroom"); assert.equal(g.intent, 'explain_service'); assert.equal(g.service_id, SVC.oneBed);
});

test('§6a booking outranks list: EN and SW', () => {
  for (const t of ['Which service do you offer? I want Deep cleaning tomorrow, Kilimani.', 'Mnafanya nini? Nataka deep cleaning kesho Kilimani']) {
    const r = u(t); assert.equal(r.kind, 'book_service', t); assert.ok(r.intents.includes('book') && !r.intents.includes('services'), t); assert.equal(r.clear, true, t);
    const g = gate(t); assert.equal(g.intent, 'other', t); assert.equal(g.reason, 'book_outranks_list', t); assert.equal(g.confidence, 'high', t);
  }
  assert.equal(gate('Which services do you offer?').intent, 'list_services');
});
test('§6a machine books instead of listing (EN, SW)', async () => {
  process.env.BRAIN_V2_NLU_GAPS = '1';
  try {
    for (const [t, re] of [['Which service do you offer? I want Deep cleaning tomorrow, Kilimani.', /What time/], ['Mnafanya nini? Nataka deep cleaning kesho Kilimani', /Saa ngapi/]]) {
      const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
      const r = await V2.runTurn(st, { text: t, profile: DD, now: NOW, handlers: {}, langLock: /Mnafanya/.test(t) ? 'sw' : 'en' });
      assert.match(r.line, re, t); assert.equal(st.intent, 'book', t);
    }
  } finally { delete process.env.BRAIN_V2_NLU_GAPS; }
});

test('§6b no order without a named, confirmed, in-stock catalogue item (EN, SW)', async () => {
  process.env.BRAIN_V2_NLU_GAPS = '1';
  try {
    for (const lines of [['Do you have a big engineering drawing set?', 'Yes, yes.'], ['I want to order a big engineering drawing set', 'Yes, yes.', 'Yes'], ['Mna big engineering drawing set?', 'Ndio, ndio.']]) {
      const log = []; const handlers = { createServiceRequest: async (r) => (log.push(r), { id: 'sr' }), saveCallerInfo: async () => ({ ok: true }) };
      const st = V2.createState({ profile: RS, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
      for (const text of lines) await V2.runTurn(st, { text, profile: RS, now: NOW, handlers });
      assert.equal(log.length, 0, lines.join(' / '));
    }
    const oos = { ...RS, productCatalog: RS.productCatalog.map((p) => (p.name === 'Diary' ? { ...p, in_stock: 'no' } : p)) };
    const log = []; const handlers = { createServiceRequest: async (r) => (log.push(r), { id: 'sr' }), saveCallerInfo: async () => ({ ok: true }) };
    const st = V2.createState({ profile: oos, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
    const r = await V2.runTurn(st, { text: 'I want to order two diaries', profile: oos, now: NOW, handlers });
    await V2.runTurn(st, { text: 'Yes', profile: oos, now: NOW, handlers });
    assert.doesNotMatch(r.line, /Shall I|Nikuwekee|read/i); assert.equal(log.length, 0);
  } finally { delete process.env.BRAIN_V2_NLU_GAPS; }
});

test('§6c bare name: give_name at the opening or when pending; never a service/area/filler word', () => {
  const r = u('Chris.', { opening: true }); assert.equal(r.kind, 'give_name'); assert.equal(r.name, 'Chris'); assert.ok(r.confidence >= 0.5 && r.confidence < 0.8);
  assert.equal(u('Wanjiku', { expecting: 'name' }).name, 'Wanjiku');
  for (const t of ['Okay.', 'Karibu.', 'Kilimani.', 'Carpet.', 'Kesho.', 'Asante.']) assert.equal(u(t, { opening: true }).name, null, t);
  assert.equal(u('Chris.').nameCandidate, 'Chris');
});
test('§6c machine greets a bare name instead of "help regarding Chris" (EN, SW)', async () => {
  process.env.BRAIN_V2_NLU_GAPS = '1';
  try {
    for (const [lines, lang, re] of [[['Chris.'], 'en', /Thanks, Chris/], [['Hello', 'Chris.'], 'en', /Thanks, Chris/], [['Habari', 'Chris.'], 'sw', /^Chris, unahitaji/]]) {
      const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
      let r; for (const text of lines) r = await V2.runTurn(st, { text, profile: DD, now: NOW, handlers: {}, langLock: lang });
      assert.match(r.line, re, lines.join(' / ')); assert.doesNotMatch(r.line, /regarding/);
    }
  } finally { delete process.env.BRAIN_V2_NLU_GAPS; }
});

// S32_sw_do_you_clean_carpet: a service check on a catalogue item answers with the grounded price,
// with VOICE_V2_CATALOGUE on (spoken catalogue) and off (items[] price_range); no slot claim, no re-list.
const withEnv = async (env, fn) => { const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; } try { return await fn(); } finally { for (const k of Object.keys(old)) { if (old[k] == null) delete process.env[k]; else process.env[k] = old[k]; } } };
const CHECKS = [
  ['en', 'do you clean carpets?'], ['en', 'And do you guys like clean carpets?'], ['en', 'do you also do carpets?'], ['en', 'even carpets?'],
  ['sw', 'Mnasafisha carpet?'], ['sw', 'mnaosha carpet?'], ['sw', 'Mpaka carpet?'], ['sw', 'Carpet mnadhanioshea?'],
];
for (const sc of [null, '1']) {
  test(`§4 service check answers with the grounded price (VOICE_V2_CATALOGUE=${sc || 'off'}), EN + SW`, async () => {
    await withEnv({ BRAIN_V2_NLU_GAPS: '1', VOICE_V2_CATALOGUE: sc }, async () => {
      for (const [lang, t] of CHECKS) {
        const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
        const r = await V2.runTurn(st, { text: t, profile: DD, now: NOW, handlers: {}, langLock: lang });
        const price = sc ? (lang === 'sw' ? /bei ni kuanzia shilingi 2,200 kwa mita mraba/ : /from 2,200 shillings per square metre/) : /KSh 2,200/;
        assert.match(r.line, price, t);
        assert.match(r.line, lang === 'sw' ? /^Ndio, tunafanya/ : /^Yes, we do carpet cleaning/, t);
        assert.doesNotMatch(r.line, /slot|nafasi|available|inapatikana|confirm|thibitisha/i, t); // no availability claim
        assert.doesNotMatch(r.line, /sofa|mattress|godoro|window|dirisha/i, t); // no re-list
        if (sc) assert.doesNotMatch(r.line, lang === 'sw' ? /\bKSh\b|\bshillings?\b|per m²/ : /\bKSh\b|\bshilingi\b/, t);
        // catalogue step (Voice path) gives the same grounded answer
        const cs = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
        const c = require('../src/conversation/v2/machine').catalogueTurn(cs, { text: t, profile: DD, lang, now: NOW });
        assert.ok(c && c.line === r.line, `${t}: catalogueTurn ${c && c.line}`);
        assert.ok(require('../src/conversation/v2/catalogueStep').looksCatalogue(t, DD, {}), t);
      }
    });
  });
}
test('§4 a service check with no catalogue hit never invents a yes; flag off is unchanged', async () => {
  await withEnv({ BRAIN_V2_NLU_GAPS: '1' }, async () => {
    const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
    const r = await V2.runTurn(st, { text: 'do you clean swimming pools?', profile: DD, now: NOW, handlers: {}, langLock: 'en' });
    assert.doesNotMatch(r.line, /^Yes, we do/);
  });
  await withEnv({ BRAIN_V2_NLU_GAPS: null }, async () => {
    assert.equal(require('../src/conversation/v2/machine').catalogueTurn(V2.createState({ profile: DD, callerPhone: '+2547', openRows: [], pendingTasks: [] }), { text: 'Mpaka carpet?', profile: DD, lang: 'sw', now: NOW }), null);
  });
});
