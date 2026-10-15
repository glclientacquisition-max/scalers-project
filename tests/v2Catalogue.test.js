'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('../src/knowledge/spokenCatalogue');
const C = require('../src/conversation/v2/catalogueStep');
const A = require('../src/conversation/placeAmbiguity');
const { planV2CatalogueMouth } = require('../src/conversation/v2CatalogueTurn');
const { senseCheck } = require('../src/conversation/v2/senseCheck');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const FIX = DD.profile || DD;
const P923 = { servicesCatalog: require('./fixtures/no-answer-delete/HD_923e63f8a72b.json').catalogue.map((name) => ({ name })) };
const ON = { VOICE_V2_CATALOGUE: '1', VOICE_V2_CATALOGUE_MODEL: 'off' };
const withFlag = async (fn) => { const o = process.env.VOICE_V2_CATALOGUE; process.env.VOICE_V2_CATALOGUE = '1'; try { return await fn(); } finally { if (o == null) delete process.env.VOICE_V2_CATALOGUE; else process.env.VOICE_V2_CATALOGUE = o; } };
const svc = (re) => S.compileSync(FIX).entries.find((e) => re.test(e.raw.name));

test('source hash stable; regenerates on catalogue change', () => {
  const a = S.sourceHash(FIX); assert.strictEqual(a, S.sourceHash(JSON.parse(JSON.stringify(FIX))));
  const changed = { ...FIX, servicesCatalog: [...FIX.servicesCatalog, { name: 'Curtain Cleaning', price_range: 'KSh 500' }] };
  assert.notStrictEqual(a, S.sourceHash(changed));
  assert.strictEqual(S.needsRegeneration(S.compileSync(FIX), FIX), false);
  assert.strictEqual(S.needsRegeneration(S.compileSync(FIX), changed), true);
});

test('Swahili names are Swahili; every explanation has sw and en, no price, no booking question', () => {
  for (const e of S.compileSync(FIX).entries) {
    if (e.spoken.sw) assert.ok(!/cleaning|bedroom|apartment|office|package/i.test(e.spoken.sw), e.spoken.sw);
    for (const L of ['en', 'sw']) { const x = e.explain[L]; if (!x) continue; assert.ok(!/\d|shilling|shilingi|ksh|book|\?/i.test(x), x); }
    assert.ok(e.explain.sw, `explain.sw for ${e.raw.name}`);
  }
});

test('categories: mattresses/sofas/carpets, house by size, deep, offices', () => {
  const cs = S.compileSync(FIX).categories;
  assert.deepStrictEqual(cs.map((c) => c.id).slice(0, 4), ['items', 'house', 'deep', 'office']);
  assert.match(cs[0].sw, /^usafi wa magodoro, sofa, mazulia/); assert.strictEqual(cs[1].sw, 'usafi wa nyumba kulingana na ukubwa'); assert.match(cs[3].sw, /maofisi/);
});

test('prices: units kept; odd amounts flagged, not spoken', () => {
  assert.strictEqual(S.priceRules('KSh 800', { name: 'Sofa Cleaning (per seat)' }).sw, 'shilingi 800 kwa kiti');
  assert.strictEqual(S.priceRules('From KSh 2,200 per m²').en, 'from 2,200 shillings per square metre');
  assert.strictEqual(S.priceRules('From KSh 500', { name: 'Hourly Housekeeping' }).sw, 'kuanzia shilingi 500 kwa saa');
  const odd = S.priceRules('KSh 40', { name: 'Post-Construction Clean' });
  assert.strictEqual(odd.en, null); assert.strictEqual(odd.review, 'odd_price');
  const sc = S.compileSync({ servicesCatalog: [{ name: 'Post-Construction Clean', price_range: 'KSh 40' }] });
  assert.ok(sc.issues.some((i) => i.code === 'odd_price'));
});

test('findEntry: token match, longest wins (1-Bedroom never hits carpet per room)', () => {
  const sc = S.compileSync(FIX);
  assert.match(S.findEntry("I don't understand what you're saying by 1-Bedroom", sc).raw.name, /^1-Bedroom/);
  assert.match(S.findEntry('how much is carpet cleaning', sc).raw.name, /^Carpet/);
  assert.match(S.findEntry('fridge deep clean', sc).raw.name, /Refrigerator/);
});

test('AI pass checked against source: invented inclusions, digits, raw English rejected; unknown ids dropped', async () => {
  const profile = { servicesCatalog: [{ name: 'Sofa Cleaning', price_range: 'KSh 800', notes: 'Shampoo, vacuum' }, { name: 'Mattress cleaning', price_range: 'Ksh 800-1200' }] };
  const sc = await S.compileSpokenCatalogue(profile, { generate: async () => ({ entries: [
    { id: 'svc_sofa_cleaning', name_en: 'sofa cleaning', name_sw: 'usafi wa sofa', explain_en: 'It means we shampoo and vacuum your sofa.', explain_sw: 'Tunasafisha sofa kwa shampoo na vacuum.' },
    { id: 'svc_mattress_cleaning', name_sw: 'Mattress cleaning', explain_en: 'It means steam sanitising and stain removal.' },
    { id: 'svc_invented', name_en: 'car wash' },
  ] }) });
  const sofa = sc.entries.find((e) => e.id === 'svc_sofa_cleaning');
  assert.strictEqual(sofa.explain.en, 'It means we shampoo and vacuum your sofa.');
  assert.ok(sc.issues.some((i) => i.id === 'svc_mattress_cleaning' && i.code === 'raw_english_in_sw'));
  assert.ok(sc.issues.some((i) => i.id === 'svc_mattress_cleaning' && /^invented_inclusion/.test(i.code)));
  assert.ok(sc.issues.some((i) => i.code === 'unknown_id_dropped'));
});

test('per-field hashes: a price change keeps an owner-edited spoken name', async () => {
  const sc = await S.compileSpokenCatalogue(FIX);
  const id = sc.entries[0].id;
  S.applyOwnerEdit(sc, { id, field: 'spoken', lang: 'sw', value: 'kusafisha magodoro' });
  const changed = { ...FIX, servicesCatalog: FIX.servicesCatalog.map((s, i) => (i === 0 ? { ...s, price_range: 'KSh 900-1,300' } : s)) };
  const next = await S.compileSpokenCatalogue(changed, { previous: sc });
  const e = next.entries.find((x) => x.id === id);
  assert.strictEqual(e.spoken.sw, 'kusafisha magodoro'); assert.strictEqual(e.price.sw, 'shilingi 900 hadi 1,300');
  assert.strictEqual(next.version, sc.version + 1);
  const renamed = { ...FIX, servicesCatalog: FIX.servicesCatalog.map((s, i) => (i === 0 ? { ...s, notes: 'All sizes' } : s)) };
  assert.notStrictEqual((await S.compileSpokenCatalogue(renamed, { previous: sc })).entries.find((x) => x.id === id).spoken.sw, 'kusafisha magodoro');
});

test('shared gazetteer: Rongai/Ongata Rongai for every tenant, no Kiambu Kiambu', () => {
  const g = A.ambiguityFor('rongai');
  assert.deepStrictEqual(g.options, ['Rongai', 'Ongata Rongai']);
  assert.strictEqual(A.ambiguityFor('Ongata Rongai').heard, 'rongai');
  assert.ok(!A.gazetteer().groups.some((x) => x.options.some((o) => /^(\w+) \1$/i.test(o))));
  const cov = S.coverageRules({ serviceAreas: { areas: [{ id: 'county:kiambu' }, { id: 'place:ongata rongai' }] } });
  assert.strictEqual(cov.places.find((p) => p.key === 'kiambu').canonical, 'Kiambu');
  assert.strictEqual(cov.places.find((p) => p.key === 'ongata rongai').canonical, 'Ongata Rongai');
  assert.ok(cov.ambiguityGroups.some((x) => x.heard === 'rongai'));
});

test('command validation rejects unknown service, missing slot, extra keys', () => {
  const sc = S.compileSync(FIX);
  assert.strictEqual(C.validateCommand({ intent: 'price_service', service_id: 'svc_nope', language: 'sw' }, sc).ok, false);
  assert.strictEqual(C.validateCommand({ intent: 'price_service', language: 'sw' }, sc).ok, false);
  assert.strictEqual(C.validateCommand({ intent: 'list_services', language: 'en', reply: 'hi' }, sc).ok, false);
  assert.strictEqual(C.validateCommand({ intent: 'list_services', language: 'en' }, sc).ok, true);
});

test('intent from nlu; reply from receipts via spoken catalogue (S65 / S66 shapes)', () => withFlag(async () => {
  let r = await C.runCatalogueStep({ text: 'Uniambie usasi gani mnafanya.', profile: FIX, lang: 'sw', state: {} });
  assert.match(r.line, /magodoro/); assert.match(r.line, /nyumba kulingana na ukubwa/); assert.match(r.line, /maofisi/);
  r = await C.runCatalogueStep({ text: "I don't understand what you're saying by 1-Bedroom.", profile: FIX, lang: 'en', state: {} });
  assert.match(r.line, /one-bedroom home/); assert.ok(!/book|shilling|\?/i.test(r.line), r.line);
  r = await C.runCatalogueStep({ text: 'Bei ya sofa ni ngapi?', profile: FIX, lang: 'sw', state: {} });
  assert.match(r.line, /^Bei ya usafi wa sofa ni shilingi 800 kwa kiti\./);
}));

test('valid model command is used; invalid or slow model falls back to nlu', () => withFlag(async () => {
  const id = svc(/^Sofa/).id;
  const ok = async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'price_service', service_id: id, language: 'sw' }) }] } }] });
  let r = await C.runCatalogueStep({ text: 'na hiyo ya viti je?', profile: FIX, lang: 'sw', state: {}, model: ok });
  assert.strictEqual(r.trace.source, 'model'); assert.match(r.line, /usafi wa sofa/);
  const bad = async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"price_service","service_id":"svc_made_up","language":"sw"}' }] } }] });
  r = await C.runCatalogueStep({ text: 'Mnafanya services gani?', profile: FIX, lang: 'sw', state: {}, model: bad });
  assert.strictEqual(r.trace.source, 'nlu'); assert.ok(r.trace.modelError);
  r = await C.runCatalogueStep({ text: 'Mnafanya services gani?', profile: FIX, lang: 'sw', state: {}, model: () => new Promise((res) => setTimeout(res, 500)), timeoutMs: 30 });
  assert.strictEqual(r.trace.source, 'nlu'); assert.match(r.trace.modelError, /timeout/);
}));

test('flag off: legacy plan returned untouched (same object), nothing logged', async () => {
  const legacy = { speakLocal: false, line: '' }; const logs = [];
  assert.strictEqual(await planV2CatalogueMouth(legacy, { text: 'Mnafanya services gani?', profile: FIX, language: 'sw', state: {}, env: {}, log: (m) => logs.push(m) }), legacy);
  assert.strictEqual(logs.length, 0);
});

test('flag on: v2 owns the services turn, legacy rewrites only log in shadow; repeats move forward', () => withFlag(async () => {
  const legacy = { speakLocal: true, line: 'Tuna Apartment na House Cleaning, Deep Cleaning, na zingine. Unahitaji gani?', reason: 'phase0' }; const logs = []; const state = {};
  const out = await planV2CatalogueMouth(legacy, { text: 'ni huduma gani mnapea', profile: P923, language: 'sw', state, env: ON, log: (m) => logs.push(m) });
  assert.strictEqual(out.reason, 'v2_catalogue');
  assert.ok(logs.some((l) => /shadow catalogue_mouth would have spoken/.test(l)));
  const lines = [out.line];
  for (const t of ['Umesema mnafanya nini tena?', 'Umesema mnafanya nini tena?']) lines.push((await planV2CatalogueMouth(null, { text: t, profile: P923, language: 'sw', state, env: ON })).line);
  assert.strictEqual(new Set(lines).size, 3, lines.join(' | '));
  for (const l of lines) { assert.ok(senseCheck({ line: l, lang: 'sw', intent: 'services', sc: S.compileSync(P923) }).ok, l); assert.strictEqual((l.match(/\?/g) || []).length, 1); }
}));

test('sense-check replay over every HD fixture passes', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'v2-catalogue-sense.js')], { encoding: 'utf8' });
  assert.match(out, /sense-check fails: 0/); assert.match(out, /HD_923e63f8a72b/); assert.match(out, /HD_b401138c8ffd/);
});
