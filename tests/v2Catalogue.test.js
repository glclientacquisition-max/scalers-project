'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('../src/knowledge/spokenCatalogue');
const C = require('../src/conversation/v2/catalogueStep');
const { planV2CatalogueMouth } = require('../src/conversation/v2CatalogueTurn');
const { senseCheck } = require('../src/conversation/v2/senseCheck');
const FIX = require('./fixtures/voice-calls/HD_015bae4a4af2.json');
const P923 = { servicesCatalog: require('./fixtures/no-answer-delete/HD_923e63f8a72b.json').catalogue.map((name) => ({ name })) };
const ON = { VOICE_V2_CATALOGUE: '1', VOICE_V2_CATALOGUE_MODEL: 'off' };

test('source hash is stable and changes with the catalogue', () => {
  const a = S.sourceHash(FIX); assert.strictEqual(a, S.sourceHash(JSON.parse(JSON.stringify(FIX))));
  const changed = { ...FIX, servicesCatalog: [...FIX.servicesCatalog, { name: 'Curtain Cleaning', price_range: 'KSh 500' }] };
  assert.notStrictEqual(a, S.sourceHash(changed));
  const sc = S.compileSync(FIX);
  assert.strictEqual(S.needsRegeneration(sc, FIX), false);
  assert.strictEqual(S.needsRegeneration(sc, changed), true);
});

test('every Swahili spoken name is Swahili (no raw catalogue name), prices only from the catalogue', () => {
  const sc = S.compileSync(FIX);
  for (const e of sc.entries) {
    if (e.spoken.sw) assert.ok(!/cleaning|bedroom|apartment|office|package/i.test(e.spoken.sw), e.spoken.sw);
    for (const n of e.price.numbers) assert.ok(e.raw.price.replace(/,/g, '').includes(String(n)), `${n} from ${e.raw.price}`);
  }
  assert.strictEqual(S.priceRules('KSh 500 per hour (min 3 hours)').sw, 'shilingi 500 kwa saa, angalau saa 3');
  assert.strictEqual(S.priceRules('Ksh 800-1200').en, '800 to 1,200 shillings');
  assert.ok(S.priceRules('Custom quote (KSh 35-150 per sq m per month)').quote);
});

test('AI pass is field-checked: bad fields fall back to rules and are flagged; unknown ids dropped', async () => {
  const profile = { servicesCatalog: [{ name: 'Sofa Cleaning', price_range: 'KSh 800 per seat', notes: 'Shampoo, vacuum' }, { name: 'Mattress cleaning', price_range: 'Ksh 800-1200' }] };
  const generate = async () => ({ entries: [
    { id: 'svc_sofa_cleaning', name_en: 'sofa cleaning', name_sw: 'usafi wa sofa', category_en: 'sofa and carpet cleaning', category_sw: 'usafi wa sofa na zulia', explain_en: 'We shampoo and vacuum your sofa.', explain_sw: 'Tunasafisha sofa kwa shampoo na vacuum.' },
    { id: 'svc_mattress_cleaning', name_sw: 'Mattress cleaning', explain_en: 'Only 500 today, guaranteed', category_sw: 'usafi wa magodoro' },
    { id: 'svc_invented', name_en: 'free car wash' },
  ] });
  const sc = await S.compileSpokenCatalogue(profile, { generate });
  assert.strictEqual(sc.generator, 'ai+rules');
  const sofa = sc.entries.find((e) => e.id === 'svc_sofa_cleaning');
  assert.strictEqual(sofa.explain.sw, 'Tunasafisha sofa kwa shampoo na vacuum.');
  const m = sc.entries.find((e) => e.id === 'svc_mattress_cleaning');
  assert.strictEqual(m.spoken.sw, 'usafi wa godoro');
  assert.ok(sc.issues.some((i) => i.id === 'svc_mattress_cleaning' && i.code === 'raw_english_in_sw'));
  assert.ok(sc.issues.some((i) => i.field === 'explain_en' && i.code === 'digits'));
  assert.ok(sc.issues.some((i) => i.code === 'unknown_id_dropped'));
  assert.ok(!sc.entries.some((e) => e.id === 'svc_invented'));
  assert.strictEqual(sc.status, 'draft');
});

test('AI failure keeps the rules baseline', async () => {
  const sc = await S.compileSpokenCatalogue(FIX, { generate: async () => { throw new Error('boom'); } });
  assert.strictEqual(sc.generator, 'rules'); assert.strictEqual(sc.aiError, 'boom');
  assert.strictEqual(sc.entries.length, FIX.servicesCatalog.length);
});

test('owner edits survive regeneration while their row is unchanged; approve sets status', async () => {
  let sc = await S.compileSpokenCatalogue(FIX);
  S.applyOwnerEdit(sc, { id: sc.entries[0].id, field: 'spoken', lang: 'sw', value: 'kusafisha magodoro' });
  S.approve(sc, { by: null });
  const changed = { ...FIX, servicesCatalog: FIX.servicesCatalog.map((s, i) => (i === 1 ? { ...s, price_range: 'KSh 3,500 flat' } : s)) };
  const next = await S.compileSpokenCatalogue(changed, { previous: sc });
  assert.strictEqual(next.entries[0].spoken.sw, 'kusafisha magodoro');
  assert.strictEqual(next.entries[0].status, 'approved');
  assert.strictEqual(next.entries[1].status, 'draft');
  assert.strictEqual(next.status, 'draft');
  assert.strictEqual(next.version, sc.version + 1);
});

test('coverage: canonical full names and ambiguity groups (Rongai vs Ongata Rongai)', () => {
  const cov = S.coverageRules({ serviceAreas: { areas: [{ id: 'place:rongai' }, { id: 'place:kilimani' }] } });
  const r = cov.places.find((p) => p.key === 'rongai');
  assert.strictEqual(r.canonical, 'Ongata Rongai');
  const g = cov.ambiguityGroups.find((x) => x.heard === 'rongai');
  assert.ok(g && g.options.includes('Ongata Rongai') && g.options.includes('Rongai'));
  assert.ok(!cov.ambiguityGroups.some((x) => x.heard === 'kilimani'));
});

test('command validation: unknown service / missing slot rejected', () => {
  const sc = S.compileSync(FIX);
  assert.strictEqual(C.validateCommand({ intent: 'price_service', service_id: 'svc_nope', language: 'sw' }, sc).ok, false);
  assert.strictEqual(C.validateCommand({ intent: 'price_service', language: 'sw' }, sc).ok, false);
  assert.strictEqual(C.validateCommand({ intent: 'say_anything', language: 'sw' }, sc).ok, false);
  assert.strictEqual(C.validateCommand({ intent: 'list_services', language: 'en', reply: 'hi' }, sc).ok, false);
  assert.strictEqual(C.validateCommand({ intent: 'list_services', language: 'en' }, sc).ok, true);
});

test('template with a missing slot yields to legacy instead of speaking a hole', () => {
  const sc = S.compileSync({ servicesCatalog: [{ name: 'Zorbing Thing' }] });
  const r = C.decide({ command: { intent: 'price_service', service_id: sc.entries[0].id, language: 'en' }, sc, lang: 'en' });
  assert.strictEqual(r.line, null);
  assert.throws(() => C.render('en', 'price', { name: 'x' }));
});

test('model command is used when valid; invalid or slow model falls back to rules', async () => {
  const sc = S.compileSync(FIX);
  const id = sc.entries.find((e) => /sofa/i.test(e.raw.name)).id;
  const ok = async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'price_service', service_id: id, language: 'sw' }) }] } }] });
  let r = await C.runCatalogueStep({ text: 'na hiyo ya viti?', profile: FIX, lang: 'sw', model: ok });
  assert.strictEqual(r.trace.source, 'model'); assert.match(r.line, /^Bei ya usafi wa sofa ni shilingi 800 kwa kiti\./);
  const bad = async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"price_service","service_id":"svc_made_up","language":"sw"}' }] } }] });
  r = await C.runCatalogueStep({ text: 'Mnafanya services gani?', profile: FIX, lang: 'sw', model: bad });
  assert.strictEqual(r.trace.source, 'rules'); assert.ok(r.trace.modelError);
  const slow = () => new Promise((res) => setTimeout(res, 2000));
  r = await C.runCatalogueStep({ text: 'Mnafanya services gani?', profile: FIX, lang: 'sw', model: slow, timeoutMs: 30 });
  assert.strictEqual(r.trace.source, 'rules'); assert.match(r.line, /^Tunafanya /);
});

test('flag off: legacy plan returned untouched (same object), nothing logged', async () => {
  const legacy = { speakLocal: false, line: '' }; const logs = [];
  const out = await planV2CatalogueMouth(legacy, { text: 'Mnafanya services gani?', profile: FIX, language: 'sw', state: {}, env: {}, log: (m) => logs.push(m) });
  assert.strictEqual(out, legacy); assert.strictEqual(logs.length, 0);
});

test('flag on: v2 owns the services turn, legacy rewrites only log in shadow', async () => {
  const legacy = { speakLocal: true, line: 'Tuna Apartment na House Cleaning, Deep Cleaning, na zingine. Unahitaji gani?', reason: 'phase0' }; const logs = [];
  const out = await planV2CatalogueMouth(legacy, { text: 'ni huduma gani mnapea', profile: P923, language: 'sw', state: {}, env: ON, log: (m) => logs.push(m) });
  assert.strictEqual(out.reason, 'v2_catalogue');
  assert.strictEqual(out.line, 'Tunafanya usafi wa nyumba, usafi wa kina, usafi wa ofisi na usafi wa sofa na zulia. Ungependa ipi?');
  assert.ok(logs.some((l) => /shadow catalogue_mouth would have spoken/.test(l)));
  assert.strictEqual((out.line.match(/\?/g) || []).length, 1, 'no doubled question (HD_923e T7)');
});

test('flag on: non-catalogue turn keeps legacy', async () => {
  const legacy = { speakLocal: false };
  assert.strictEqual(await planV2CatalogueMouth(legacy, { text: 'Mmh, okay, I don\'t know.', profile: FIX, language: 'en', state: {}, env: ON }), legacy);
});

test('repeat asks move forward instead of re-dumping (HD_923e / HD_b401 context)', async () => {
  const state = {}; const lines = [];
  for (const t of ['ni huduma gani mnapea', 'Umesema mnafanya nini tena?', 'Umesema mnafanya nini tena?', 'Mnawapa which services tena?']) {
    lines.push((await planV2CatalogueMouth(null, { text: t, profile: P923, language: 'sw', state, env: ON })).line);
  }
  assert.strictEqual(new Set(lines).size, lines.length, lines.join(' | '));
  for (const l of lines) assert.ok(senseCheck({ line: l, lang: 'sw', intent: 'list_services', sc: S.compileSync(P923) }).ok, l);
});

test('sense-check replay over every HD fixture passes', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'v2-catalogue-sense.js')], { encoding: 'utf8' });
  assert.match(out, /sense-check fails: 0/);
  assert.match(out, /HD_923e63f8a72b/); assert.match(out, /HD_b401138c8ffd/);
});
