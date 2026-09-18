const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const {
  ALT_CAP_NAMES,
  JUNK_NAMES,
  MERGE_CASES,
  NAME_SAME,
  PHONE_NORMALIZE,
  PHONE_PARSE,
  REAL_NAMES,
} = require('./fixtures/contactIdentityVectors');

const voiceIdentity = require('../src/conversation/contactIdentity');
const voiceMatch = require('../src/conversation/callerNameMatch');
const voiceQuality = require('../src/conversation/callerNameQuality');
const voiceImport = require('../src/conversation/contactImport');
const { normalizeKenyaE164: voiceKenya } = require('../src/conversation/liveTransferReady');

const REPO = path.join(__dirname, '..');
const tsCache = new Map();

function deskRel(fromFile, spec) {
  const abs = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(`${abs}.ts`)) return `${abs}.ts`;
  if (fs.existsSync(abs)) return abs;
  return `${abs}.ts`;
}

function toCjs(source) {
  const exported = [];
  let next = source.replace(/import\s+type\s+\{[^}]*\}\s+from\s+["'][^"']+["'];?/g, '');
  next = next.replace(
    /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g,
    (_m, names, spec) => {
      const cleaned = names
        .split(',')
        .map((part) => part.replace(/\btype\b/g, '').trim())
        .filter(Boolean)
        .join(', ');
      return `const { ${cleaned} } = require("${spec}");`;
    }
  );
  next = next.replace(/export type \{[^}]*\}[^;]*;/g, '');
  next = next.replace(/export type [A-Za-z0-9_]+[^=]*=[^;]+;/g, '');
  next = next.replace(/export const ([A-Za-z0-9_]+)/g, (_m, name) => {
    exported.push(name);
    return `const ${name}`;
  });
  next = next.replace(/export function ([A-Za-z0-9_]+)/g, (_m, name) => {
    exported.push(name);
    return `function ${name}`;
  });
  next += `\nmodule.exports = { ${[...new Set(exported)].join(', ')} };\n`;
  return next;
}

function loadDeskTs(relFromRepo) {
  const abs = path.isAbsolute(relFromRepo)
    ? relFromRepo
    : path.join(REPO, relFromRepo);
  if (tsCache.has(abs)) return tsCache.get(abs);

  const raw = fs.readFileSync(abs, 'utf8');
  const stripped = Module.stripTypeScriptTypes(raw, { mode: 'transform' });
  const outputText = toCjs(stripped);

  const loaded = { exports: {} };
  const localRequire = (spec) => {
    if (spec.startsWith('./') || spec.startsWith('../')) {
      return loadDeskTs(deskRel(abs, spec));
    }
    return Module.createRequire(abs)(spec);
  };
  const run = new Function(
    'module',
    'exports',
    'require',
    'console',
    outputText
  );
  run(loaded, loaded.exports, localRequire, console);
  tsCache.set(abs, loaded.exports);
  return loaded.exports;
}

describe('Voice and Desk contact identity lockstep', () => {
  let deskIdentity;
  let deskMatch;
  let deskQuality;
  let deskImport;
  let deskHandoff;

  before(() => {
    deskIdentity = loadDeskTs('dashboard/src/lib/contactIdentity.ts');
    deskMatch = loadDeskTs('dashboard/src/lib/callerNameMatch.ts');
    deskQuality = loadDeskTs('dashboard/src/lib/callerNameQuality.ts');
    deskImport = loadDeskTs('dashboard/src/lib/contactImport.ts');
    deskHandoff = loadDeskTs('dashboard/src/lib/handoffMode.ts');
  });

  it('normalizes Kenya 0712 / 2547 / +2547 the same, and keeps non-Kenya fallbacks', () => {
    for (const row of PHONE_NORMALIZE) {
      assert.equal(
        voiceKenya(row.raw),
        row.kenya,
        `voice kenya ${JSON.stringify(row.raw)}`
      );
      assert.equal(
        deskHandoff.normalizeKenyaE164(row.raw),
        row.kenya,
        `desk kenya ${JSON.stringify(row.raw)}`
      );
      assert.equal(
        voiceIdentity.normalizeStoredPhone(row.raw),
        row.stored,
        `voice stored ${JSON.stringify(row.raw)}`
      );
      assert.equal(
        deskIdentity.normalizeStoredPhone(row.raw),
        row.stored,
        `desk stored ${JSON.stringify(row.raw)}`
      );
      assert.equal(
        deskHandoff.normalizeStoredPhone(row.raw),
        row.stored,
        `desk handoff stored ${JSON.stringify(row.raw)}`
      );
    }
  });

  it('parses writer phones the same for live, CSV, and manual', () => {
    for (const row of PHONE_PARSE) {
      const voice = voiceIdentity.parseStoredContactPhone(row.raw);
      const desk = deskIdentity.parseStoredContactPhone(row.raw);
      const voiceCsv = voiceImport.parseDialableContactPhone(row.raw);
      const deskCsv = deskImport.parseDialableContactPhone(row.raw);
      assert.equal(voice.ok, row.ok, `voice parse ${JSON.stringify(row.raw)}`);
      assert.equal(desk.ok, row.ok, `desk parse ${JSON.stringify(row.raw)}`);
      assert.deepEqual(voice, desk);
      assert.deepEqual(voice, voiceCsv);
      assert.deepEqual(desk, deskCsv);
      if (row.ok) {
        assert.equal(voice.phone, row.phone);
      }
    }
  });

  it('rejects the same junk names and keeps real names', () => {
    for (const name of JUNK_NAMES) {
      assert.equal(voiceQuality.isJunkCallerName(name), true, `voice junk ${name}`);
      assert.equal(deskQuality.isJunkCallerName(name), true, `desk junk ${name}`);
    }
    for (const name of REAL_NAMES) {
      assert.equal(
        voiceQuality.isJunkCallerName(name),
        deskQuality.isJunkCallerName(name),
        `junk lockstep ${name}`
      );
      assert.equal(voiceQuality.isJunkCallerName(name), false, `real ${name}`);
    }
  });

  it('uses the same fuzzy Kenya name match', () => {
    for (const row of NAME_SAME) {
      assert.equal(
        voiceMatch.namesLikelySame(row.a, row.b),
        row.same,
        `voice same ${row.a}/${row.b}`
      );
      assert.equal(
        deskMatch.namesLikelySame(row.a, row.b),
        row.same,
        `desk same ${row.a}/${row.b}`
      );
    }
    assert.deepEqual(
      voiceMatch.KENYA_GIVEN_NAMES.map((row) => [row.canonical, [...row.aliases]]),
      deskMatch.KENYA_GIVEN_NAMES.map((row) => [row.canonical, [...row.aliases]])
    );
    assert.deepEqual(voiceMatch.NAME_COLLISION_GROUPS, deskMatch.NAME_COLLISION_GROUPS);
  });

  it('merges primary vs alternate_names the same, including cap 5', () => {
    for (const row of MERGE_CASES) {
      const voice = voiceIdentity.mergeContactIdentity(row.existing, row.incoming);
      const desk = deskIdentity.mergeContactIdentity(row.existing, row.incoming);
      assert.equal(voice.name, row.name, `voice merge ${row.id}`);
      assert.equal(desk.name, row.name, `desk merge ${row.id}`);
      assert.deepEqual(
        voice.metadata.alternate_names.map((alt) => alt.name),
        row.alts,
        `voice alts ${row.id}`
      );
      assert.deepEqual(
        desk.metadata.alternate_names.map((alt) => alt.name),
        row.alts,
        `desk alts ${row.id}`
      );
      assert.deepEqual(voice.metadata.alternate_names, desk.metadata.alternate_names);
    }

    let existing = { name: 'Amina', metadata: { alternate_names: [] } };
    for (const name of ALT_CAP_NAMES) {
      existing = {
        name: existing.name,
        metadata: voiceIdentity.mergeContactIdentity(existing, { name }).metadata,
      };
    }
    const voiceCap = existing.metadata.alternate_names.map((row) => row.name);
    existing = { name: 'Amina', metadata: { alternate_names: [] } };
    for (const name of ALT_CAP_NAMES) {
      existing = {
        name: existing.name,
        metadata: deskIdentity.mergeContactIdentity(existing, { name }).metadata,
      };
    }
    const deskCap = existing.metadata.alternate_names.map((row) => row.name);
    assert.deepEqual(voiceCap, ['G', 'F', 'E', 'D', 'C']);
    assert.deepEqual(deskCap, voiceCap);
    assert.equal(voiceCap.length, voiceIdentity.ALT_CAP);
    assert.equal(deskCap.length, deskIdentity.ALT_CAP);
  });

  it('plans CSV and manual creates through the shared parse and merge', () => {
    const csv = 'name,phone,notes\nIsha,0712345678,\nHaijawekwa,+14155552671,\nX,unknown,';
    const voicePlan = voiceImport.planContactCsv(csv);
    const deskPlan = deskImport.planContactCsv(csv);
    assert.equal(voicePlan.ok, true);
    assert.equal(deskPlan.ok, true);
    assert.equal(voicePlan.summary.create, 2);
    assert.equal(deskPlan.summary.create, 2);
    assert.equal(voicePlan.create[0].phone, '+254712345678');
    assert.equal(voicePlan.create[0].name, 'Aisha');
    assert.equal(voicePlan.create[1].phone, '+14155552671');
    assert.equal(voicePlan.create[1].name, null);
    assert.equal(voicePlan.rejected.length, 1);
    assert.deepEqual(
      voicePlan.create.map((row) => ({ phone: row.phone, name: row.name })),
      deskPlan.create.map((row) => ({ phone: row.phone, name: row.name }))
    );
    assert.equal(voicePlan.rejected[0].reason, deskPlan.rejected[0].reason);

    const voiceManual = voiceImport.planManualContact({
      name: 'Wanjiko',
      phone: '254700000001',
    });
    const deskManual = deskImport.planManualContact({
      name: 'Wanjiko',
      phone: '254700000001',
    });
    assert.equal(voiceManual.ok, true);
    assert.equal(voiceManual.phone, '+254700000001');
    assert.equal(voiceManual.name, 'Wanjiku');
    assert.deepEqual(
      { ok: voiceManual.ok, phone: voiceManual.phone, name: voiceManual.name },
      { ok: deskManual.ok, phone: deskManual.phone, name: deskManual.name }
    );
  });
});
