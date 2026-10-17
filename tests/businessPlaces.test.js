'use strict';

// VOICE_BUSINESS_PLACES (default off): the business's own address, landmarks
// and curated aliases are trusted places in the speech guard.
// HD_c427511e5773 (prod Aris, 17 Oct 2026 20:34 EAT): "inside the University
// of Nairobi premises" (file: "Inside UON premises") was dropped as
// unbound_place on t3 and t4.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const places = require('../src/conversation/businessPlaces');
const { createVoiceTrace } = require('../src/speech/voiceTrace');

const FIXTURE = require(path.join(__dirname, 'fixtures', 'guard-business-places', 'HD_c427511e5773.json'));
const PROFILE = FIXTURE.profile;

function withFlag(value, fn) {
  const before = process.env.VOICE_BUSINESS_PLACES;
  if (value == null) delete process.env.VOICE_BUSINESS_PLACES;
  else process.env.VOICE_BUSINESS_PLACES = value;
  try {
    return fn();
  } finally {
    if (before == null) delete process.env.VOICE_BUSINESS_PLACES;
    else process.env.VOICE_BUSINESS_PLACES = before;
  }
}

function quiet(fn) {
  const { warn, log } = console;
  console.warn = () => {};
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
    console.log = log;
  }
}

function guard(text, caller, opts = {}) {
  const ctx = {
    profile: opts.profile || PROFILE,
    callerTurns: [caller],
    language: opts.language || 'en',
    dropReasons: [],
    trustedPlaces: [],
    allowEmpty: true,
    toolResults: [],
    state: opts.state || { conversation: { turnCount: opts.turn || 3 }, entities: {} },
  };
  const out = quiet(() => guardSpokenReply(text, ctx));
  return { out, drops: ctx.dropReasons, trusted: ctx.trustedPlaces };
}

test('flag is off unless on/1/true/yes', () => {
  assert.equal(places.businessPlacesEnabled({}), false);
  assert.equal(places.businessPlacesEnabled({ VOICE_BUSINESS_PLACES: 'off' }), false);
  assert.equal(places.businessPlacesEnabled({ VOICE_BUSINESS_PLACES: '0' }), false);
  for (const v of ['on', '1', 'true', 'YES', ' On ']) {
    assert.equal(places.businessPlacesEnabled({ VOICE_BUSINESS_PLACES: v }), true, v);
  }
});

for (const flag of [null, 'off']) {
  test(`parity (${flag == null ? 'unset' : 'off'}): HD_c427511e5773 t3/t4/t5 replay exactly as 8ee9b161`, () => {
    withFlag(flag, () => {
      for (const turn of FIXTURE.turns) {
        const r = guard(turn.model, turn.caller, { turn: turn.turn });
        assert.equal(r.out, turn.spokenBefore, `t${turn.turn}`);
        assert.deepEqual(r.drops, turn.dropBefore, `t${turn.turn}`);
        assert.deepEqual(r.trusted, [], `t${turn.turn}`);
      }
    });
  });
}

test('flag on: HD_c427511e5773 t3 keeps both sentences', () => {
  withFlag('on', () => {
    const t3 = FIXTURE.turns[0];
    const r = guard(t3.model, t3.caller);
    assert.equal(r.out, t3.model);
    assert.deepEqual(r.drops, []);
    assert.deepEqual(r.trusted, ['business_alias']);
  });
});

test('flag on: HD_c427511e5773 t4 is kept verbatim', () => {
  withFlag('on', () => {
    const t4 = FIXTURE.turns[1];
    const r = guard(t4.model, t4.caller, { turn: 4 });
    assert.equal(r.out, t4.model);
    assert.deepEqual(r.drops, []);
  });
});

test('flag on: HD_c427511e5773 t5 (UON wording) still kept', () => {
  withFlag('on', () => {
    const t5 = FIXTURE.turns[2];
    assert.equal(guard(t5.model, t5.caller, { turn: 5 }).out, t5.model);
  });
});

test('flag on: a non-business place in the same sentence still drops', () => {
  withFlag('on', () => {
    const r = guard(
      "We're inside the University of Nairobi, and we also have a shop in Kisumu.",
      'Do you have another branch?'
    );
    assert.equal(r.out, '');
    assert.deepEqual(r.drops, ['unbound_place']);
    const two = guard(
      "We're inside the University of Nairobi. We also have a shop in Kisumu.",
      'Do you have another branch?'
    );
    assert.equal(two.out, "We're inside the University of Nairobi.");
    assert.deepEqual(two.drops, ['unbound_place']);
  });
});

test('flag on: an invented town is dropped (Eldoret, Mombasa)', () => {
  withFlag('on', () => {
    for (const text of ['We are located in Eldoret.', "We're in Mombasa."]) {
      const r = guard(text, 'Do you deliver there?');
      assert.equal(r.out, '', text);
      assert.deepEqual(r.drops, ['unbound_place'], text);
    }
  });
});

test('flag on: the county of a file street is trusted, another county is not', () => {
  withFlag('on', () => {
    assert.equal(guard("We're in Nairobi, on State House Road.", 'Where are you?').out, "We're in Nairobi, on State House Road.");
    assert.equal(guard("We're in Mombasa.", 'Is that far?').out, '');
  });
});

test('flag on: alias in reverse (file long form, model acronym) and dotted acronym', () => {
  withFlag('on', () => {
    const profile = {
      businessName: 'Test Shop',
      businessLocations: [{ label: 'Main', landmark: 'University of Nairobi, main campus' }],
    };
    const r = guard("We're at UON, main campus. It's in Nairobi.", 'Where are you located?', { profile });
    assert.equal(r.out, "We're at UON, main campus. It's in Nairobi.");
    const dotted = guard('We are inside U.O.N, Hall 7.', 'Where are you located?');
    assert.equal(dotted.out, 'We are inside U.O.N, Hall 7.');
  });
});

test('flag on: Kiswahili answer with the alias is kept', () => {
  withFlag('on', () => {
    const r = guard('Tuko ndani ya University of Nairobi, State House Road.', 'Mko wapi?', { language: 'sw' });
    assert.equal(r.out, 'Tuko ndani ya University of Nairobi, State House Road.');
    assert.deepEqual(r.drops, []);
  });
});

test('flag on: an all-dropped location answer speaks the file fact, once per turn', () => {
  withFlag('on', () => {
    const state = { conversation: { turnCount: 4 }, entities: {} };
    const r = guard('We are in Kisii town.', 'Where can I find you?', { state });
    assert.equal(r.out, 'You can find us here: inside UON premises, along State house road-ground floor Hall 7.');
    assert.deepEqual(r.drops, ['unbound_place']);
    assert.deepEqual(r.trusted, ['location_fact']);
    // A second dropped chunk on the same turn does not repeat the fact.
    assert.equal(guard('We are near Kisii stage.', 'Where can I find you?', { state }).out, '');
    const sw = guard('Tuko Kisii town.', 'Mko wapi?', { language: 'sw', turn: 6 });
    assert.equal(sw.out, 'Tunapatikana hapa: inside UON premises, along State house road-ground floor Hall 7.');
  });
});

test('flag on: no location fact when the caller did not ask where the shop is', () => {
  withFlag('on', () => {
    const r = guard('We are in Kisii town.', 'Do you have T-squares?');
    assert.equal(r.out, '');
  });
});

test('flag on: no location fact when the file has no landmark or directions', () => {
  withFlag('on', () => {
    const profile = { businessName: 'X', businessLocations: [{ label: 'Main', address: 'Online only' }] };
    assert.equal(guard('We are in Kisii town.', 'Where are you located?', { profile }).out, '');
  });
});

test('flag on: the business name never makes a place trusted ("Aris Kenya" binds a Kisumu locality)', () => {
  withFlag('on', () => {
    const bp = places.businessPlacesFor(PROFILE);
    assert.equal(bp.counties.has('kisumu'), false);
    assert.deepEqual([...bp.counties], ['nairobi']);
  });
});

test('flag on: acronyms match case-sensitively (Kiswahili "ku" is not Kenyatta University)', () => {
  withFlag('on', () => {
    const profile = { businessName: 'Y', businessLocations: [{ label: 'Main', landmark: 'Opposite KU main gate' }] };
    const bp = places.businessPlacesFor(profile);
    assert.ok(bp.phrases.includes('Kenyatta University'));
    assert.equal(places.maskBusinessPlaces('nataka ku-order', bp).masked, false);
    assert.equal(places.maskBusinessPlaces('near Kenyatta University', bp).masked, true);
  });
});

test('flag on: coverage gate still runs before the place check (a trusted address never passes a coverage claim)', () => {
  const profile = {
    businessName: 'Z',
    businessLocations: [{ label: 'Main', landmark: 'Inside UON premises', directions: 'Along State house road', coverage_notes: 'Nairobi only' }],
    coverageAreas: ['Nairobi'],
  };
  for (const text of ['We cover Kisumu from the University of Nairobi.', 'Yes, we serve Kisumu from the University of Nairobi.']) {
    const off = withFlag(null, () => guard(text, 'Do you deliver to Kisumu?', { profile }));
    const on = withFlag('on', () => guard(text, 'Do you deliver to Kisumu?', { profile }));
    assert.equal(on.out, '', text);
    assert.deepEqual(on.drops, ['coverage'], text);
    assert.deepEqual(on.drops, off.drops, text);
  }
});

test('flag on: polish trace records the business-place rescue', () => {
  withFlag('on', () => {
    const t4 = FIXTURE.turns[1];
    const detail = quiet(() =>
      polishSpokenDetail(t4.model, {
        profile: PROFILE,
        callerTurns: [t4.caller],
        state: { conversation: { turnCount: 4, answersReceived: [t4.caller] }, entities: {} },
        language: 'en',
      })
    );
    assert.equal(detail.trustedPlace, 'business_alias');
    assert.ok(detail.text.includes('University of Nairobi'));
    const off = withFlag(null, () =>
      quiet(() =>
        polishSpokenDetail(t4.model, {
          profile: PROFILE,
          callerTurns: [t4.caller],
          state: { conversation: { turnCount: 4, answersReceived: [t4.caller] }, entities: {} },
          language: 'en',
        })
      )
    );
    assert.equal(off.trustedPlace, undefined);
  });
});

test('alias table: every row has a county that binds as a place', () => {
  const { bindSpokenPlace } = require('../src/conversation/kenyaPlaces');
  const rows = require('../src/conversation/data/kenyaPlaceAliases.json').aliases;
  assert.ok(rows.length > 10);
  for (const row of rows) {
    assert.ok(row.county, JSON.stringify(row));
    assert.ok(bindSpokenPlace(row.county).length > 0, row.county);
    assert.ok(Array.isArray(row.forms) && row.forms.length > 0);
  }
});

test('voiceTrace keeps an unchanged transform only when a business place kept it', () => {
  const written = [];
  const trace = createVoiceTrace({ enabled: true, sink: { write: (r) => written.push(r) }, callId: () => 'HD_test', tenantId: () => 't' });
  trace.beginTurn({ callerText: 'Where are you located?' });
  trace.noteTransform({ stage: 'polish', before: 'Same.', after: 'Same.', reason: '' });
  trace.noteTransform({ stage: 'polish', before: 'Kept.', after: 'Kept.', reason: '', trustedPlace: 'business_alias' });
  trace.commitTurn({});
  const transforms = written[0].stages.filter((s) => s.stage === 'transform');
  assert.equal(transforms.length, 1);
  assert.equal(transforms[0].trustedPlace, 'business_alias');
  assert.equal(transforms[0].reason, 'kept');
  assert.equal(transforms[0].dropped, false);
});
