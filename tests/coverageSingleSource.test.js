const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const FLAG = 'VOICE_COVERAGE_SINGLE_SOURCE';
const DD = {
  businessPolicies: {
    coverage_areas: ['county:nairobi', 'place:kitengela', 'county:kiambu', 'place:juja', 'place:ongata rongai', 'place:syokimau'],
  },
};

function withFlag(value, fn) {
  const prev = process.env[FLAG];
  if (value == null) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return fn();
  } finally {
    if (prev == null) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  }
}

const { assessCoverage, decideVisitPlace } = require('../src/conversation/visitLocation');
const single = require('../src/conversation/coverageSingleSource');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const { formatToolConfirmation } = require('../src/conversation/toolExecution');
const { formatPoliciesBlock } = require('../src/conversation/businessPolicies');

test('flag off: Rongai stays outside (HD_513dfb2fa73f behaviour kept)', () => {
  withFlag(null, () => {
    assert.strictEqual(assessCoverage('Rongai', DD), 'outside');
    assert.strictEqual(decideVisitPlace('Rongai', { profile: DD, detailAsked: true }).blocked, 'outside');
  });
});

test('flag on: Rongai and Ongata alias to listed Ongata Rongai', () => {
  withFlag('1', () => {
    assert.strictEqual(assessCoverage('Rongai', DD), 'inside');
    assert.strictEqual(assessCoverage("It's in Rongai", DD), 'inside');
    assert.strictEqual(assessCoverage('Ongata', DD), 'inside');
    assert.strictEqual(decideVisitPlace('Rongai', { profile: DD, detailAsked: true }).blocked, '');
  });
});

test('flag on: unlisted places are not swept in by the alias', () => {
  withFlag('1', () => {
    assert.strictEqual(assessCoverage('Nakuru', DD), 'outside');
    assert.strictEqual(assessCoverage('Kajiado town', DD), 'outside');
    assert.strictEqual(assessCoverage('Kisumu', DD), 'outside');
  });
});

test('flag on: a coverage claim the check does not back becomes the honest line', () => {
  withFlag('1', () => {
    const outside = single.guardCoverageClaim('Nakuru is within our coverage area. What time tomorrow?', {
      state: { visitPlace: { blocked: 'outside', coverage: 'outside' } },
      language: 'en',
    });
    assert.ok(outside.changed);
    assert.strictEqual(outside.text, 'That area is outside our coverage. Should I note it for the team?');
    const unknown = single.guardCoverageClaim('Yes, we cover that area.', {
      state: { visitPlace: { blocked: 'unknown_coverage', coverage: 'unknown' } },
      language: 'en',
    });
    assert.match(unknown.text, /not sure we cover that area\. Should I note it for the team\?/);
    const sw = single.guardCoverageClaim('Ndiyo, tunafika huko.', {
      state: { visitPlace: { blocked: 'outside', coverage: 'outside' } },
      language: 'sw',
    });
    assert.match(sw.text, /Eneo hilo liko nje\. Naweza kukuachia ujumbe/);
  });
});

test('flag on: an inside verdict keeps the claim; a denial is dropped', () => {
  withFlag('1', () => {
    const ok = single.guardCoverageClaim('Rongai is within our coverage area. What time tomorrow?', {
      state: { visitPlace: { coverage: 'inside', blocked: '' } },
    });
    assert.strictEqual(ok.changed, false);
    const deny = single.guardCoverageClaim('That area is outside our coverage. What time tomorrow?', {
      state: { visitPlace: { coverage: 'inside', blocked: '' } },
    });
    assert.strictEqual(deny.text, 'What time tomorrow?');
  });
});

test('flag on: no place heard leaves a general coverage list alone', () => {
  withFlag('1', () => {
    const r = single.guardCoverageClaim('We cover Nairobi, Kiambu and Ongata Rongai.', { state: {} });
    assert.strictEqual(r.changed, false);
  });
});

test('flag off: guard and polish are byte-identical', () => {
  withFlag(null, () => {
    const text = 'Nakuru is within our coverage area. What time tomorrow?';
    const state = { visitPlace: { blocked: 'outside', coverage: 'outside' }, conversation: { answersReceived: [] } };
    assert.strictEqual(single.guardCoverageClaim(text, { state }).changed, false);
    const a = polishSpokenDetail(text, { state, profile: DD, language: 'en' });
    assert.doesNotMatch(a.text, /Should I note it for the team/);
    assert.ok(!(a.dropReasons || []).some((r) => /^coverage_/.test(r)));
  });
});

test('flag on: polish replaces the contradicted claim end to end', () => {
  withFlag('1', () => {
    const state = { visitPlace: { blocked: 'outside', coverage: 'outside' }, conversation: { answersReceived: ['Nakuru'] } };
    const out = polishSpokenDetail('Nakuru is within our coverage area. What time tomorrow would you prefer?', {
      state,
      profile: DD,
      language: 'en',
    }).text;
    assert.doesNotMatch(out, /within our coverage/);
    assert.match(out, /outside our coverage/);
  });
});

test('downgraded visit is told honestly only with the flag on', () => {
  const r = [{ action: 'create_service_request', status: 'succeeded', visitDowngrade: true }];
  assert.strictEqual(
    formatToolConfirmation(r, 'en'),
    "Okay, I've noted your visit request. The team will call you to confirm it."
  );
  assert.strictEqual(
    formatToolConfirmation([{ action: 'create_service_request', status: 'succeeded' }], 'en'),
    "Okay, I've saved your request."
  );
});

test('executeBrainTools marks the visit downgrade only with the flag on', async () => {
  const { executeBrainTools } = require('../src/conversation/toolExecution');
  const parsed = {
    appointment: {
      serviceName: '2-Bedroom Apartment (Standard)',
      name: 'Alvin Yegon',
      whenText: 'tomorrow at 8:00 AM',
      landmark: 'Simba Drive, Grace Apartments, Rongai',
      notes: 'confirm access',
    },
  };
  const run = () =>
    executeBrainTools({
      parsed: JSON.parse(JSON.stringify(parsed)),
      capabilities: { createServiceRequest: true, createAppointment: true, confirmVisit: false, saveCallerInfo: true },
      handlers: {
        createServiceRequest: async (v) => ({ id: 'sr1', request_type: v.type, status: 'open' }),
        saveCallerInfo: async () => ({}),
      },
    });
  const on = await withFlag('1', run);
  const sr = (on.results || on).find((x) => x.action === 'create_service_request');
  assert.ok(sr, 'service request result');
  assert.strictEqual(sr.visitDowngrade, true);
  const off = await withFlag(null, run);
  const sr2 = (off.results || off).find((x) => x.action === 'create_service_request');
  assert.strictEqual(sr2.visitDowngrade, undefined);
});

test('prompt rule only with the flag on', () => {
  const off = withFlag(null, () => formatPoliciesBlock(DD.businessPolicies));
  const on = withFlag('1', () => formatPoliciesBlock(DD.businessPolicies));
  assert.doesNotMatch(off, /COVERAGE SOURCE/);
  assert.match(on, /COVERAGE SOURCE/);
});

test('fixture HD_513dfb2fa73f: check and speech agree with the flag on', async () => {
  const { replayCall } = require('../src/speech/replayVoice');
  const fixture = require(path.join(__dirname, 'fixtures', 'voice-calls', 'HD_513dfb2fa73f.coverage.json'));
  const replay = await withFlag('1', () => replayCall(fixture, { mode: 'recorded' }));
  const rows = replay.turns || replay.records || replay;
  const text = JSON.stringify(rows);
  assert.match(text, /Rongai is within our coverage area/);
  assert.doesNotMatch(text, /outside our coverage/);
});
