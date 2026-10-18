const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const CASES = require('./fixtures/name-fold-cases.json');
const AF = require('./fixtures/brain-calls/HD_af5868852bc7.call.json');
const TENANT = require('./fixtures/tenants/jirani-staging.json');
const { namesFold, nameFoldEnabled, nameFoldKey } = require('../src/conversation/nameFold');
const match = require('../src/conversation/callerNameMatch');
const { mergeContactIdentity, lockedFileName } = require('../src/conversation/contactIdentity');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const { alternateIsAPerson } = require('../src/conversation/callFixesD199');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const B = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { observeCallerInput } = require('../src/speech/callerTurnLabel');
const { planCallerModelTurn } = require('../src/conversation/turnPolicy');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const { buildSystemPrompt } = require('../src/prompts');
const { persistCompletedCallContact } = require('../src/conversation/callTranscriptReview');
const readBack = require('../src/conversation/nameReadBack');

const FLAGS = ['BRAIN_NAME_FOLD', 'BRAIN_CALL_FIXES_D199'];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
function setFlags(flags) {
  for (const k of FLAGS) {
    if (flags[k] == null) delete process.env[k];
    else process.env[k] = flags[k];
  }
}
afterEach(() => setFlags(saved));

const NOW = new Date(AF.startedAt);

function jiraniContact(extraAlternates = [], extraMeta = {}) {
  const contact = JSON.parse(JSON.stringify(AF.callerFile.contact));
  contact.metadata = { ...(contact.metadata || {}), ...extraMeta };
  contact.metadata.alternate_names = [...(contact.metadata.alternate_names || []), ...extraAlternates];
  return contact;
}

function profileWith(contact) {
  const profile = profileFromSnapshot(JSON.parse(JSON.stringify(TENANT)));
  profile.callerMemory = contact
    ? buildCallerMemoryCard({ contact, openRequests: [], openAppointments: [], now: NOW })
    : null;
  return profile;
}

function runTurns(profile, script) {
  let state = B.createBrainState(profile);
  const out = [];
  for (const [agent, text] of script) {
    const prov = B.inferIntent(text, { vertical: profile.vertical });
    const intent = prov === 'general_enquiry' && state.goal.status === 'active' ? state.intent : prov;
    const entities = extractConversationEntities(text, { profile, intent, state });
    state = B.observeCallerTurn(
      state,
      observeCallerInput(
        {
          text,
          languageState: { language: 'en', detected: 'en', sticky: 'en' },
          entities,
          profile,
          lastAgentText: agent,
        },
        { turnEnd: {} }
      )
    );
    const plan = planCallerModelTurn(state, { profile });
    const nba = determineNextBestAction({ state, capabilities: {} });
    out.push({ plan, nba, prompt: B.formatBrainStateForPrompt(state), state });
  }
  return { state, out };
}

describe('BRAIN_NAME_FOLD flag', () => {
  it('is on only for the exact value "on"', () => {
    assert.equal(nameFoldEnabled({ BRAIN_NAME_FOLD: 'on' }), true);
    for (const v of [undefined, '', 'off', 'ON', 'true', '1']) {
      assert.equal(nameFoldEnabled({ BRAIN_NAME_FOLD: v }), false, String(v));
    }
  });
});

describe('namesFold (shared contract, tests/fixtures/name-fold-cases.json)', () => {
  for (const [a, b] of CASES.fold) {
    it(`folds ${a} / ${b} both ways`, () => {
      assert.equal(namesFold(a, b), true);
      assert.equal(namesFold(b, a), true);
    });
  }
  for (const [a, b] of CASES.distinct) {
    it(`keeps ${a || '(empty)'} / ${b} distinct`, () => {
      assert.equal(namesFold(a, b), false);
      assert.equal(namesFold(b, a), false);
    });
  }
  it('maps the Kenyan-English sound swaps into one key', () => {
    assert.equal(nameFoldKey('Alwyn'), nameFoldKey('Alvin'));
    assert.equal(nameFoldKey('Philip'), nameFoldKey('Filip'));
    assert.equal(nameFoldKey('Collins'), nameFoldKey('Colin'));
  });
  it('callerNameMatch re-exports the same functions', () => {
    assert.equal(match.namesFold, namesFold);
    assert.equal(match.nameFoldKey, nameFoldKey);
  });
  it('namesLikelySame folds only with the flag on, and never with fold:false', () => {
    setFlags({});
    assert.equal(match.namesLikelySame('Alwyn', 'Alvin'), false);
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    assert.equal(match.namesLikelySame('Alwyn', 'Alvin'), true);
    assert.equal(match.namesLikelySame('Alwyn', 'Alvin', { fold: false }), false);
    assert.equal(match.namesLikelySame('Alvin', 'Kevin'), false);
  });
});

describe('alternateIsAPerson with the fold', () => {
  it('an STT spelling is not a second person (D199 on or off)', () => {
    for (const d199 of [undefined, 'on']) {
      setFlags({ BRAIN_NAME_FOLD: 'on', BRAIN_CALL_FIXES_D199: d199 });
      assert.equal(alternateIsAPerson('Alwyn', 'Alvin'), false);
      assert.equal(alternateIsAPerson('Alwyn', 'Mary'), true);
    }
  });
  it('flag off keeps the old answer', () => {
    setFlags({});
    assert.equal(alternateIsAPerson('Alwyn', 'Alvin'), true);
  });
});

describe('Jirani staging fixture HD_af5868852bc7 (Alwyn + Alvin)', () => {
  it('flag off: still a shared line (pinned)', () => {
    setFlags({ BRAIN_CALL_FIXES_D199: 'on' });
    const card = profileWith(jiraniContact()).callerMemory;
    assert.equal(card.sharedLine, true);
    assert.deepEqual(card.alternateNames, ['Alvin']);
  });

  for (const d199 of [undefined, 'on']) {
    it(`flag on (D199 ${d199 || 'off'}): one person, bound, never "Am I speaking with"`, () => {
      setFlags({ BRAIN_NAME_FOLD: 'on', BRAIN_CALL_FIXES_D199: d199 });
      const profile = profileWith(jiraniContact());
      const card = profile.callerMemory;
      assert.equal(card.sharedLine, false);
      assert.equal(card.nameFolded, true);
      assert.equal(card.identityBound, true);
      assert.equal(card.name, 'Alwyn');
      assert.deepEqual(card.alternateNames, []);
      assert.deepEqual(card.nameVariants, ['Alvin']);
      assert.equal(card.nameSpellingSource, 'primary');
      const system = buildSystemPrompt(profile, { now: NOW });
      // The static rules mention the ask generically ("if not bound"); the
      // per-call lines must never ask it for this file.
      assert.doesNotMatch(system, /Am I speaking with (?:Alwyn|Alvin)/i);
      assert.match(system, /Speaker: Alwyn \(bound/);
      assert.doesNotMatch(system, /Speaker:[^\n]*shared line/i);
      const { out } = runTurns(
        profile,
        AF.turns.map((t, i) => [i === 0 ? AF.greeting : AF.turns[i - 1].agent || '', t.caller])
      );
      for (const turn of out) {
        assert.doesNotMatch(String(turn.plan.line || ''), /Am I speaking with/i);
        assert.doesNotMatch(turn.prompt, /Am I speaking with/i);
        assert.equal(turn.state.caller.fileNameAsked || null, null);
      }
    });
  }

  it('flag on: a heard "Alvin" binds to the Alwyn file without an ask', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const { out } = runTurns(profileWith(jiraniContact()), [
      [AF.greeting, 'Hi, this is Alvin. Are you open Saturday?'],
    ]);
    assert.equal(out[0].state.caller.nameConfirmed, true);
    assert.doesNotMatch(out[0].prompt, /Am I speaking with/i);
    assert.equal(out[0].state.caller.nameReadBack, undefined);
  });

  it('flag on: a truly different name on the number stays a shared line', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on', BRAIN_CALL_FIXES_D199: 'on' });
    const card = profileWith(
      jiraniContact([{ name: 'Mary', seen_at: '2026-10-17T18:00:00Z', call_id: 'c-mary' }])
    ).callerMemory;
    assert.equal(card.sharedLine, true);
    assert.equal(card.identityBound, undefined);
    assert.deepEqual(card.alternateNames, ['Mary']);
    assert.deepEqual(card.nameVariants, ['Alvin']);
  });

  it('flag on: the most-seen spelling wins over the primary; ties keep the primary', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const twice = jiraniContact([{ name: 'Alvin', seen_at: '2026-10-18T09:00:00Z', call_id: 'c3' }]);
    assert.equal(profileWith(twice).callerMemory.name, 'Alvin');
    assert.equal(profileWith(twice).callerMemory.nameSpellingSource, 'most_seen');
    const counted = jiraniContact(
      [{ name: 'Alvin', seen_at: '2026-10-18T09:00:00Z', call_id: 'c3' }],
      { name_seen_count: 3 }
    );
    assert.equal(profileWith(counted).callerMemory.name, 'Alwyn');
  });
});

describe('owner lock contract on the card', () => {
  it('name_locked: never shared, bound to contacts.name, even with a different name stored', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on', BRAIN_CALL_FIXES_D199: 'on' });
    const contact = jiraniContact(
      [
        { name: 'Alvin', seen_at: '2026-10-18T09:00:00Z', call_id: 'c3' },
        { name: 'Mary', seen_at: '2026-10-18T09:00:00Z', call_id: 'c4' },
      ],
      { name_locked: { at: '2026-10-18T10:00:00Z', by: 'owner' } }
    );
    const card = profileWith(contact).callerMemory;
    assert.equal(card.name, 'Alwyn');
    assert.equal(card.sharedLine, false);
    assert.equal(card.identityBound, true);
    assert.deepEqual(card.alternateNames, []);
    assert.equal(card.nameSpellingSource, 'locked_owner');
  });

  it('single_person: never shared, bound to contacts.name', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on', BRAIN_CALL_FIXES_D199: 'on' });
    const contact = jiraniContact([{ name: 'Mary', seen_at: 't', call_id: 'c4' }], {
      single_person: true,
    });
    const card = profileWith(contact).callerMemory;
    assert.equal(card.sharedLine, false);
    assert.equal(card.identityBound, true);
    assert.equal(card.name, 'Alwyn');
    assert.equal(card.nameSpellingSource, 'single_person');
  });

  it('a dismissed alternate never makes the line shared', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on', BRAIN_CALL_FIXES_D199: 'on' });
    const contact = jiraniContact([{ name: 'Mary', seen_at: 't', call_id: 'c4' }], {
      alternate_names_dismissed: [{ name: 'Mary', at: '2026-10-18T10:00:00Z' }],
    });
    const card = profileWith(contact).callerMemory;
    assert.equal(card.sharedLine, false);
    assert.deepEqual(card.alternateNames, []);
  });

  it('flag off ignores the lock markers (Desk/Voice flags own their side)', () => {
    setFlags({ BRAIN_CALL_FIXES_D199: 'on' });
    const contact = jiraniContact([{ name: 'Mary', seen_at: 't', call_id: 'c4' }], {
      single_person: true,
      name_locked: { at: 't', by: 'owner' },
    });
    const card = profileWith(contact).callerMemory;
    assert.equal(card.sharedLine, true);
  });
});

describe('mergeContactIdentity (Brain copy) with the fold', () => {
  const alwyn = () => ({
    name: 'Alwyn',
    metadata: { alternate_names: [{ name: 'Alvin', seen_at: 't1', call_id: 'c1' }] },
  });

  it('a folded incoming name is not added and does not re-spell the name', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const next = mergeContactIdentity({ name: 'Alwyn', metadata: {} }, { name: 'Alvin', callId: 'c2' });
    assert.equal(next.name, 'Alwyn');
    assert.deepEqual(next.metadata.alternate_names, []);
  });

  it('keeps existing folded alternates (history; no rewrite)', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const next = mergeContactIdentity(alwyn(), { name: 'Alwyn' });
    assert.deepEqual(next.metadata.alternate_names.map((r) => r.name), ['Alvin']);
  });

  it('a truly different name is still logged', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const next = mergeContactIdentity(alwyn(), { name: 'Mary', callId: 'c3', seenAt: 't3' });
    assert.equal(next.name, 'Alwyn');
    assert.deepEqual(next.metadata.alternate_names.map((r) => r.name), ['Mary', 'Alvin']);
  });

  it('flag off: the folded name is still logged as an alternate (pinned)', () => {
    setFlags({});
    const next = mergeContactIdentity({ name: 'Alwyn', metadata: {} }, { name: 'Alvin' });
    assert.deepEqual(next.metadata.alternate_names.map((r) => r.name), ['Alvin']);
  });

  it('name_locked: never replaced or re-spelled, no alternates added', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const locked = {
      name: 'Alwyn',
      metadata: { name_locked: { at: 't', by: 'caller' }, alternate_names: [] },
    };
    for (const incoming of ['Alvin', 'Mary', 'alwyn', 'Alwyn Otieno']) {
      const next = mergeContactIdentity(locked, { name: incoming, callId: 'c9' });
      assert.equal(next.name, 'Alwyn', incoming);
      assert.deepEqual(next.metadata.alternate_names, [], incoming);
      assert.deepEqual(next.metadata.name_locked, { at: 't', by: 'caller' });
    }
    assert.equal(lockedFileName(locked.metadata, 'Alwyn'), 'Alwyn');
    assert.equal(lockedFileName({}, 'Alwyn'), null);
  });

  it('a dismissed name is never added back', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const contact = {
      name: 'Alwyn',
      metadata: { alternate_names: [], alternate_names_dismissed: [{ name: 'Mary', at: 't' }] },
    };
    const next = mergeContactIdentity(contact, { name: 'mary', callId: 'c5' });
    assert.equal(next.name, 'Alwyn');
    assert.deepEqual(next.metadata.alternate_names, []);
  });
});

describe('first-call spelling read-back', () => {
  const { buildBrainCapabilities } = require('../src/conversation/brainPolicy');
  const home = {
    vertical: 'home_services',
    servicesCatalog: [{ name: 'Carpet cleaning', price_range: '1,500-2,000' }],
    agentTools: { escalate: true, end_call: true },
  };
  const caps = buildBrainCapabilities(home);
  // New number (no file). After the third turn every booking fact is in:
  // main goes straight to CREATE_REQUEST here.
  const toCommit = (name = 'Alex') => [
    ['', `Book carpet cleaning tomorrow at 10 AM. My name is ${name}.`],
    ['Where?', 'Location is Barnabas'],
    ['Which landmark?', 'Green Park gate'],
  ];
  function runHome(script, profile = home) {
    let state = B.createBrainState(profile);
    const out = [];
    for (const [agent, text] of script) {
      const prov = B.inferIntent(text, { vertical: profile.vertical });
      const intent = prov === 'general_enquiry' && state.goal.status === 'active' ? state.intent : prov;
      const entities = extractConversationEntities(text, { profile, intent, state });
      state = B.observeCallerTurn(state, {
        text,
        languageState: { current: 'en' },
        entities,
        profile,
        lastAgentText: agent,
      });
      out.push({ state, nba: determineNextBestAction({ state, capabilities: caps }) });
    }
    return { state, out };
  }

  it('flag off: main saves at the commit point (pinned)', () => {
    setFlags({});
    const { out } = runHome(toCommit());
    assert.equal(out[2].nba.action, 'CREATE_REQUEST');
    assert.equal(out[2].state.caller.nameReadBack, undefined);
  });

  it('flag on: slot collection is untouched; the save turn becomes one name_readback', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const { out } = runHome(toCommit());
    assert.equal(out[0].nba.slot, 'location');
    assert.equal(out[1].nba.slot, 'location');
    assert.equal(out[2].nba.action, 'ASK_CLARIFICATION');
    assert.equal(out[2].nba.slot, 'name_readback');
    assert.equal(out[2].nba.name, 'Alex');
    assert.equal(readBack.readBackHoldsSave(out[2].state), true);
  });

  it('an explicit yes to the read-back binds, releases the save, and locks by caller', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const { out, state } = runHome([...toCommit(), ['Alex, A-L-E-X, is that right?', 'Yes.']]);
    assert.equal(state.caller.nameReadBack.status, 'confirmed');
    assert.equal(state.caller.nameConfirmed, true);
    assert.equal(out[3].nba.action, 'CREATE_REQUEST');
    assert.equal(readBack.readBackHoldsSave(state), false);
    assert.deepEqual(deriveCallSummary({ brainState: state }).nameLock, { name: 'Alex', by: 'caller' });
  });

  it("the caller's correction binds the corrected spelling", () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const { state } = runHome([
      ...toCommit('Brian'),
      ['Brian, did I get that right?', 'No, it is B R Y A N.'],
    ]);
    assert.equal(state.caller.nameReadBack.status, 'confirmed');
    assert.equal(state.caller.nameReadBack.via, 'correction');
    assert.equal(state.caller.name, 'Bryan');
    assert.equal(deriveCallSummary({ brainState: state }).nameLock.name, 'Bryan');
  });

  it('a filler yes to some other question does not count', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const { state } = runHome([...toCommit(), ['Shall I book it for ten?', 'Yes.']]);
    assert.notEqual(state.caller.nameReadBack.status, 'confirmed');
    assert.equal(deriveCallSummary({ brainState: state }).nameLock, undefined);
  });

  it('"Sawa" or "Okay" to the read-back itself is not a yes', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    for (const ack of ['Sawa.', 'Okay.']) {
      const { state } = runHome([...toCommit(), ['Alex, is that right?', ack]]);
      assert.equal(state.caller.nameReadBack.status, 'unanswered', ack);
      assert.equal(deriveCallSummary({ brainState: state }).nameLock, undefined, ack);
    }
  });

  it('a plain "no" declines without locking', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const { state } = runHome([...toCommit(), ['Alex, is that right?', 'No.']]);
    assert.equal(state.caller.nameReadBack.status, 'declined');
    assert.equal(deriveCallSummary({ brainState: state }).nameLock, undefined);
  });

  it('asked once: after an answer the slot never comes back', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const { out } = runHome([
      ...toCommit(),
      ['Alex, is that right?', 'Sawa.'],
      ['Anything else?', 'Tomorrow at 10 AM is fine.'],
    ]);
    assert.notEqual(out[3].nba.slot, 'name_readback');
    assert.notEqual(out[4].nba.slot, 'name_readback');
  });

  it('an unspoken read-back is offered twice at most, then the save goes ahead', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const { out } = runHome([
      ...toCommit(),
      ['Shall I book it?', 'Please do.'],
      ['Anything else?', 'Book it.'],
    ]);
    assert.equal(out[4].state.caller.nameReadBack.status, 'skipped');
    assert.notEqual(out[4].nba.slot, 'name_readback');
  });

  it('no save ahead (a question only): no read-back slot', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    const { out } = runHome([['', 'Hi, my name is Alex, what time do you close?']]);
    assert.notEqual(out[0].nba.slot, 'name_readback');
  });

  it('never on a known contact or a locked one', () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    for (const meta of [{}, { name_locked: { at: 't', by: 'owner' } }]) {
      const contact = { name: 'Alex', phone: '+254700000001', metadata: meta };
      const profile = {
        ...home,
        callerMemory: buildCallerMemoryCard({ contact, openRequests: [], openAppointments: [], now: NOW }),
      };
      const { out } = runHome(toCommit(), profile);
      assert.equal(out[2].state.caller.nameReadBack, undefined, JSON.stringify(meta));
      assert.notEqual(out[2].nba.slot, 'name_readback');
    }
  });

  it('spelledName reads letter-by-letter spellings only', () => {
    assert.equal(readBack.spelledName('It is B R Y A N.'), 'Bryan');
    assert.equal(readBack.spelledName('B-R-I-A-N'), 'Brian');
    assert.equal(readBack.spelledName('I want a plumber'), null);
  });
});

describe('post-call write sets name_locked by caller', () => {
  const call = { id: 'call-1', tenant_id: 't1', from_number: '+254700000001', name: null, summary: {} };

  it('flag on + confirmed read-back: the contact name is the confirmed spelling, locked by caller', async () => {
    setFlags({ BRAIN_NAME_FOLD: 'on' });
    let row = null;
    await persistCompletedCallContact(
      { callSid: 'CA1', call, extractedName: 'Brian', summary: { nameLock: { name: 'Bryan', by: 'caller' } } },
      { upsertContact: async (r) => { row = r; return r; } }
    );
    assert.equal(row.name, 'Bryan');
    assert.equal(row.metadata.name_locked.by, 'caller');
    assert.ok(row.metadata.name_locked.at);
  });

  it('flag off: no lock is written', async () => {
    setFlags({});
    let row = null;
    await persistCompletedCallContact(
      { callSid: 'CA1', call, extractedName: 'Brian', summary: { nameLock: { name: 'Bryan', by: 'caller' } } },
      { upsertContact: async (r) => { row = r; return r; } }
    );
    assert.equal(row.metadata, undefined);
  });
});
