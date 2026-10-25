'use strict';
// Brain coverage on Desk's tenant_area_picks (docs/reference/platform/AREA_PICKS.md, Desk #930).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const AP = require('../src/conversation/v2/areaPicks');
const AC = require('../src/conversation/v2/areaCoverage');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const DD = { ...DD0, id: DD0.tenantId };
const PICKS = { version: 1, tree_version: 'ke-areas-2026-10-24.1', picks: [
  { node: 'county:nairobi', serve: true, fee_kes: null, note: null },
  { node: 'estate:nairobi:kibera', serve: false, fee_kes: null, note: null },
  { node: 'town:kajiado:kitengela', serve: true, fee_kes: 500, note: 'Weekends only' },
  { node: 'county:kiambu', serve: true, fee_kes: 300, note: null },
] };
const P = { ...DD, areaPicksConfirmedAt: '2026-10-25T08:00:00Z', areaPicks: PICKS };
const DESK_TS = path.join(__dirname, '../dashboard/src/lib/areaPicks.ts');
const treeHere = AP.available();

test('tree is Desk\'s file (one tree, no Brain copy) and the landmark seed is gone', { skip: !treeHere && 'Desk tree not on this branch yet (#930)' }, () => {
  assert.match(AP.treeVersion(), /^ke-areas-\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.ok(!fs.existsSync(path.join(__dirname, '../src/conversation/data/kenyaAreaTree.v1.json')));
  assert.equal(AC.LANDMARKS, undefined);
});

test('picks: nearest pick wins, fee and note heard, EN + SW (Desk preview lines)', { skip: !treeHere && 'needs #930 tree' }, () => {
  const L = (t, lang = 'en') => AC.line(AC.resolve(t, P), lang);
  assert.equal(L('do you do Kileleshwa?'), 'Yes, we cover Kileleshwa.');
  assert.equal(L('I am in Kibera'), "Sorry, we don't cover Kibera.");
  assert.equal(AC.resolve('I am in Kibera', P).status, 'excluded');
  assert.equal(L('Do you come to Kitengela?'), "Yes, we cover Kitengela. There's an extra KES 500. Weekends only.");
  assert.equal(L('Mnafika Kitengela?', 'sw'), 'Ndio, tunafika Kitengela. Kuna ada ya ziada ya KES 500. Weekends only.');
  assert.equal(L('Niko Ruiru', 'sw'), 'Ndio, tunafika Ruiru. Kuna ada ya ziada ya KES 300.', 'fee inherits from the county pick');
  assert.equal(L('Mnafika Kisumu?', 'sw'), 'Nitaangalia na mmiliki kuhusu Kisumu.');
  assert.equal(AC.resolve('Mnafika Kisumu?', P).status, 'unknown');
  assert.equal(AC.resolve('Mnafika Kisumu?', P).via, 'no_pick');
  assert.equal(L('Do you cover Kwa Mzee?'), 'Which area is that near?');
  assert.equal(L('Niko Kileleshwani', 'sw'), 'Ndio, tunafika Kileleshwa.');
  assert.equal(L('Kilelesha'), 'Yes, we cover Kileleshwa.');
  assert.equal(L('near Westgate'), 'Yes, we cover Westlands.', 'Desk landmark');
  assert.equal(L('kibra'), "Sorry, we don't cover Kibera.", 'Desk alias');
  for (const t of ["Where's your coverage?", 'you can put it under Alvin.', 'Yeah, I do so.', '2:00 PM.', 'Ndio, sawa.']) assert.equal(AC.resolve(t, P), null, t);
});

test('fallback to legacy lists only when the tenant has no picks', { skip: !treeHere && 'needs #930 tree' }, () => {
  assert.equal(AC.resolve('Kileleshwa', DD).source, undefined, 'no areaPicks -> legacy');
  assert.equal(AC.resolve('Kileleshwa', { ...DD, areaPicks: { picks: [] } }).source, undefined, 'empty picks -> legacy');
  assert.equal(AC.resolve('Kileleshwa', { ...DD, areaPicks: { picks: [{ node: 'estate:nowhere:x', serve: true }] } }).source, undefined, 'unknown nodes dropped -> legacy');
  assert.equal(AC.resolve('Juja', DD).status, 'covered', 'legacy place:juja');
  assert.equal(AC.resolve('Juja', P).status, 'covered', 'picks: Juja under county:kiambu');
  assert.equal(AC.resolve('Syokimau', P).via, 'no_pick', 'picks win over legacy: Syokimau not picked');
  assert.match(AC.line(AC.resolve('Syokimau', P), 'en'), /check with the owner/i);
  process.env.BRAIN_AREA_PICKS = 'off';
  try { assert.equal(AC.resolve('Syokimau', P).status, 'covered', 'knob off -> legacy'); } finally { delete process.env.BRAIN_AREA_PICKS; }
});

test('fail safe: no tree file -> picks ignored, legacy answers, no crash', () => {
  const r = spawnSync(process.execPath, ['-e', `
    const M = require('module'); const o = M._resolveFilename;
    M._resolveFilename = function (req, ...a) { if (/kenyaAreaTree/.test(req)) throw Object.assign(new Error('missing'), { code: 'MODULE_NOT_FOUND' }); return o.call(this, req, ...a); };
    const AC = require('./src/conversation/v2/areaCoverage'); const AP = require('./src/conversation/v2/areaPicks');
    const DD = require('./evals/v2/fixtures/tenants/done_and_dusted.json');
    const r = AC.resolve('do you do Kileleshwa?', { ...DD, areaPicksConfirmedAt: '2026-10-25T08:00:00Z', areaPicks: { picks: [{ node: 'county:nairobi', serve: true }] } });
    process.stdout.write(JSON.stringify({ avail: AP.available(), status: r && r.status, line: AC.line(r, 'en') }));`], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { avail: false, status: 'covered', line: 'Yes, we cover Kileleshwa.' });
});

test('fail safe: the profile loader treats a missing table / error as no picks', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/db.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function loadAreaPicks'), src.indexOf('async function loadAreaPicks') + 700);
  assert.match(fn, /from\('tenant_area_picks'\)/); assert.match(fn, /if \(error \|\| !data\) return \{ areaPicks: null, areaPicksConfirmedAt: null \}/); assert.match(fn, /catch \{\s*return \{ areaPicks: null \}/); assert.match(fn, /select\('picks, tree_version, confirmed_at'\)/);
  const { tenantProfileFromRow } = require('../src/tenantProfile');
  assert.equal(tenantProfileFromRow({ id: 't' }, {}).areaPicks, null);
  assert.deepEqual(tenantProfileFromRow({ id: 't' }, { areaPicks: PICKS }).areaPicks, PICKS);
});

// Parity with Desk's reference (dashboard/src/lib/areaPicks.ts): same callerHears for the same picks + place.
// Needs a node that can strip TS types (>= 22.6, or NODE_TS=/path/to/node).
const tsNode = process.env.NODE_TS || process.execPath;
const tsOk = fs.existsSync(DESK_TS) && spawnSync(tsNode, ['--experimental-strip-types', '-e', '1'], { encoding: 'utf8' }).status === 0;
test('parity: Brain callerHears == Desk callerHears (preview = bot target)', { skip: !tsOk && 'needs Desk areaPicks.ts (#930) and node >= 22.6 (set NODE_TS)' }, () => {
  const places = ['Kileleshwa', 'kileleshwa', 'Kilelesha', 'Kileleshua', 'Kibera', 'kibra', 'Kitengela', 'Ruiru', 'Juja', 'Thika', 'Kiambu', 'Kisumu', 'Mombasa', 'Westgate', 'Sarit Centre', 'Maasai Mall', 'Rongai', 'Ongata Rongai', 'Westlands', 'Karen', 'Syokimau', 'Nakuru', 'Kwa Mzee', 'Langata', 'Lavington', 'Embakasi', 'Kilimani', 'Ngong', 'Athi River', 'Utawala'];
  const r = spawnSync(tsNode, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', `
    const m = await import(${JSON.stringify('file://' + DESK_TS)});
    const p = m.normalizeAreaPicks(${JSON.stringify(PICKS)});
    process.stdout.write(JSON.stringify(${JSON.stringify(places)}.map((x) => { const h = m.callerHears(p, x); return [h.status, h.reply, h.node && h.node.id]; })));`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const desk = JSON.parse(r.stdout);
  const p = AP.normalizeAreaPicks(PICKS);
  places.forEach((x, i) => { const h = AP.callerHears(p, x); assert.deepEqual([h.status, h.reply, h.node && h.node.id], desk[i], x); });
  // and the in-call resolver says the Desk line for the bare place name
  places.forEach((x, i) => {
    const r2 = AC.resolve(x, { ...DD, areaPicksConfirmedAt: '2026-10-25T08:00:00Z', areaPicks: PICKS });
    if (desk[i][0] !== 'not_on_map' && r2 && r2.via !== 'no_pick') assert.equal(AC.line(r2, 'en'), desk[i][1], `in-call ${x}`);
  });
});

// ---- area notes (owner free text, <= 120 chars; Desk #944: rules live only in note, never parsed) ----
const PICKS_NOTE = { version: 1, tree_version: 'ke-areas-2026-10-24.1', picks: [
  { node: 'county:nairobi', serve: true, fee_kes: null, note: null },
  { node: 'estate:nairobi:kibera', serve: false, fee_kes: null, note: null },
  { node: 'county:kiambu', serve: true, fee_kes: 300, note: 'From 2 bedrooms up' },
  { node: 'town:kiambu:thika', serve: true, fee_kes: 800, note: 'Wikendi tu' },
  { node: 'town:kiambu:juja', serve: false, fee_kes: null, note: null },
] };
const PN = { ...DD, areaPicksConfirmedAt: '2026-10-25T08:00:00Z', areaPicks: PICKS_NOTE };

test('note: inherited like fee_kes from the nearest serving pick; an exclude stops it', { skip: !treeHere && 'needs #930 tree' }, () => {
  const p = AP.normalizeAreaPicks(PICKS_NOTE); const id = (q) => AP.matchAreaText(q).id;
  assert.deepEqual(AP.resolveArea(p, id('Ruiru')), { covered: true, via: 'county:kiambu', fee_kes: 300, note: 'From 2 bedrooms up' });
  assert.deepEqual(AP.resolveArea(p, id('Thika')), { covered: true, via: 'town:kiambu:thika', fee_kes: 800, note: 'Wikendi tu' });
  assert.deepEqual(AP.resolveArea(p, id('Juja')), { covered: false, via: 'town:kiambu:juja', fee_kes: null, note: null });
  assert.equal(AP.resolveArea(p, id('Kileleshwa')).note, null);
  const long = AP.normalizeAreaPicks({ picks: [{ node: 'county:kiambu', serve: true, note: 'x'.repeat(200), conditions: [{ kind: 'min_bedrooms', value: 2 }] }] }).picks[0];
  assert.equal(long.note.length, 120); assert.equal('conditions' in long, false, 'no conditions field is built');
});

test('note: owed coverage answer + pre-name check speak it after the fee, verbatim, EN + SW; no booking gate', { skip: !treeHere && 'needs #930 tree' }, () => {
  const L = (t, lang = 'en') => AC.line(AC.resolve(t, PN), lang);
  assert.equal(L('Do you come to Ruiru?'), "Yes, we cover Ruiru. There's an extra KES 300. From 2 bedrooms up.");
  assert.equal(L('Niko Ruiru', 'sw'), 'Ndio, tunafika Ruiru. Kuna ada ya ziada ya KES 300. From 2 bedrooms up.', 'English-only note: verbatim, not machine-translated');
  assert.equal(L('Mnafika Thika?', 'sw'), 'Ndio, tunafika Thika. Kuna ada ya ziada ya KES 800. Wikendi tu.');
  // flagged: an English-only note in a Swahili turn
  const p = AP.normalizeAreaPicks(PICKS_NOTE); const ru = AP.matchAreaText('Ruiru'); const th = AP.matchAreaText('Thika');
  assert.equal(AP.linesFor(p, ru, 'sw').note_untranslated, true);
  assert.equal(AP.linesFor(p, ru, 'en').note_untranslated, false);
  assert.equal(AP.linesFor(p, th, 'sw').note_untranslated, false);
  // the check_coverage receipt carries the note as an owner fact (with its language)
  const ML = require('../src/conversation/v2/modelLead'); const OW = require('../src/conversation/v2/owed');
  const rec = ML.coverageFor('Niko Ruiru', PN).places[0];
  assert.equal(rec.note, 'From 2 bedrooms up'); assert.equal(rec.note_lang, 'en');
  assert.equal(OW.render({ topic: 'coverage', sub: 'Ruiru', row: rec, lang: 'sw' }, { profile: PN }), L('Ruiru', 'sw'));
  assert.equal(ML.coverageFor('Juja', PN).places[0].note, null);
  // pre-name booking check: the same line, and the note never blocks (a 1-bedroom job in Ruiru is not refused by code)
  const CP = require('../src/conversation/v2/callPlan');
  const o = CP.owed({ intent: 'book', slots: { service: '1-Bedroom Standard Clean', place: 'Ruiru', when: { date: '2026-10-27', time: '10:00' } } }, PN, { kind: 'ask', slot: 'name' });
  assert.equal(o.blocked, false);
  assert.equal(o.items[0].row.line_en, "Yes, we cover Ruiru. There's an extra KES 300. From 2 bedrooms up.");
  assert.equal(o.items[0].row.note_lang, 'en');
  assert.equal(OW.render({ ...o.items[0], lang: 'sw' }, { profile: PN }), 'Ndio, tunafika Ruiru. Kuna ada ya ziada ya KES 300. From 2 bedrooms up.');
});

test('parity with notes: Brain callerHears == Desk callerHears', { skip: !tsOk && 'needs Desk areaPicks.ts and node >= 22.6 (set NODE_TS)' }, () => {
  const places = ['Ruiru', 'Thika', 'Juja', 'Kiambu', 'Kileleshwa', 'Kibera', 'Kisumu'];
  const r = spawnSync(tsNode, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', `
    const m = await import(${JSON.stringify('file://' + DESK_TS)});
    const p = m.normalizeAreaPicks(${JSON.stringify(PICKS_NOTE)});
    process.stdout.write(JSON.stringify(${JSON.stringify(places)}.map((x) => { const h = m.callerHears(p, x); return [h.status, h.reply, h.node && h.node.id]; })));`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const desk = JSON.parse(r.stdout); const p = AP.normalizeAreaPicks(PICKS_NOTE);
  places.forEach((x, i) => { const h = AP.callerHears(p, x); assert.deepEqual([h.status, h.reply, h.node && h.node.id], desk[i], x); });
});

test('note: Desk example shape; no-note picks unchanged; unconfirmed seeded tenant (Jirani-style) speaks no note', { skip: !treeHere && 'needs #930 tree' }, () => {
  const desk = { ...DD, areaPicksConfirmedAt: '2026-10-25T08:00:00Z', areaPicks: { picks: [{ node: 'town:kiambu:thika', serve: true, fee_kes: 800, note: 'From 2 bedrooms up' }] } };
  assert.equal(AC.line(AC.resolve('Do you cover Thika?', desk), 'en'), "Yes, we cover Thika. There's an extra KES 800. From 2 bedrooms up.");
  const bare = { ...DD, areaPicksConfirmedAt: '2026-10-25T08:00:00Z', areaPicks: { picks: [{ node: 'town:kiambu:thika', serve: true, fee_kes: null, note: null }] } };
  assert.equal(AC.line(AC.resolve('Thika', bare), 'en'), 'Yes, we cover Thika.');
  assert.equal(AC.line(AC.resolve('Thika', bare), 'sw'), 'Ndio, tunafika Thika.');
  assert.equal(AP.linesFor(AP.normalizeAreaPicks(bare.areaPicks), AP.matchAreaText('Thika'), 'sw').note_untranslated, false);
  const seeded = { ...DD, areaPicksConfirmedAt: null, areaPicks: { picks: [{ node: 'town:kiambu:thika', serve: true, fee_kes: 800, note: 'From 2 bedrooms up' }] } };
  assert.equal(AC.line(AC.resolve('Thika', seeded), 'en'), "I'll check with the owner about Thika.");
  assert.equal(AC.line(AC.resolve('Thika', seeded), 'sw'), 'Nitaangalia na mmiliki kuhusu Thika.');
  const ML = require('../src/conversation/v2/modelLead');
  assert.equal(ML.coverageFor('Thika', seeded).places[0].note, null, 'unconfirmed: no note on the receipt');
});

test('unified reader: alias -> tree node; confirmed fee+note; unconfirmed/missing pick -> check with owner', { skip: !treeHere && 'needs #930 tree' }, () => {
  const ML = require('../src/conversation/v2/modelLead');
  const alias = AC.resolve('kibra', P);
  assert.equal(alias.name, 'Kibera');
  assert.equal(alias.status, 'excluded');
  const kit = ML.coverageFor('Kitengela', P).places[0];
  assert.equal(kit.covered, 'yes');
  assert.equal(kit.fee_kes, 500);
  assert.equal(kit.note, 'Weekends only');
  const seeded = { ...DD, areaPicksConfirmedAt: null, areaPicks: PICKS };
  const miss = ML.coverageFor('Kisumu', { ...DD, areaPicksConfirmedAt: '2026-10-25T08:00:00Z', areaPicks: PICKS }).places[0];
  assert.equal(miss.covered, 'unknown');
  assert.match(miss.line_en, /check with the owner/i);
  const pend = ML.coverageFor('Kileleshwa', seeded).places[0];
  assert.equal(pend.covered, 'unknown');
  assert.match(pend.line_en, /check with the owner/i);
});
