// 18 Oct owner review (Desk REVIEW-2026-10-18): honest owner text.
// BRAIN_CALL_FIXES_D199=on fixes it; off keeps today's text (pinned).
//   - calls: tests/fixtures/brain-calls/owner-text-18oct.json (staging D&D, prod Esga)
//   - tenants: tests/fixtures/tenants/done-and-dusted-staging.json, esga-prod.json
// Each call replays its caller turns through Brain state in turn order, then
// derives the hangup summary and merges the stored owner_review (standing in
// for the reviewer's JSON, which is not stored).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CALLS = require('./fixtures/brain-calls/owner-text-18oct.json').calls;
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const DND = profileFromSnapshot(require('./fixtures/tenants/done-and-dusted-staging.json'));
const ESGA_SNAPSHOT = require('./fixtures/tenants/esga-prod.json');
const ESGA = profileFromSnapshot(ESGA_SNAPSHOT);
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const { deriveCallResolution } = require('../src/conversation/callResolution');
const {
  mergeTranscriptReview,
  normalizeMood,
  runPostCallTranscriptReview,
  toolFlagsFromBrain,
} = require('../src/conversation/callTranscriptReview');
const { validateServiceRequest } = require('../src/conversation/toolExecution');
const { buildCallFactsRow } = require('../src/conversation/callFacts');
const fixesD199 = require('../src/conversation/callFixesD199');
const topics = require('../src/conversation/ownerTopic');
const provenance = require('../src/conversation/provenance');

function withFlag(value, fn) {
  const prev = process.env.BRAIN_CALL_FIXES_D199;
  if (value == null) delete process.env.BRAIN_CALL_FIXES_D199;
  else process.env.BRAIN_CALL_FIXES_D199 = value;
  try {
    return fn();
  } finally {
    if (prev == null) delete process.env.BRAIN_CALL_FIXES_D199;
    else process.env.BRAIN_CALL_FIXES_D199 = prev;
  }
}

async function withFlagAsync(value, fn) {
  const prev = process.env.BRAIN_CALL_FIXES_D199;
  if (value == null) delete process.env.BRAIN_CALL_FIXES_D199;
  else process.env.BRAIN_CALL_FIXES_D199 = value;
  try {
    return await fn();
  } finally {
    if (prev == null) delete process.env.BRAIN_CALL_FIXES_D199;
    else process.env.BRAIN_CALL_FIXES_D199 = prev;
  }
}

function call(id) {
  const row = CALLS.find((c) => c.callId === id);
  assert.ok(row, id);
  return row;
}

/** Replay one call: hangup summary, resolution, flags, and the merged review. */
function replay(id) {
  const row = call(id);
  const profile = row.tenant === 'esga' ? ESGA : DND;
  let state = createBrainState(profile);
  const bind = () => {
    state.caller = { ...state.caller, name: row.nameConfirmed.name, nameConfirmed: true };
  };
  if (row.nameConfirmed && row.nameConfirmed.atTurn == null) bind();
  for (const turn of row.turns) {
    const entities = extractConversationEntities(turn.caller, { profile, intent: state.intent, state });
    state = observeCallerTurn(state, { text: turn.caller, profile, language: turn.language, entities });
    if (row.nameConfirmed && row.nameConfirmed.atTurn === turn.turn) bind();
  }
  // Saved rows as written: through the request validator, as the live tool path does.
  const rows = row.savedRows.map((saved, i) => {
    const value = validateServiceRequest(
      { type: saved.request_type, name: 'Caller Name', item: saved.item, quantity: saved.quantity, notes: saved.notes },
      { productCatalog: profile.productCatalog }
    ).value;
    return {
      action: 'create_service_request',
      status: 'succeeded',
      requestType: value.type,
      value,
      record: { id: `sr-${i}`, item: value.item },
    };
  });
  state.actions = { ...(state.actions || {}), savedWork: rows };
  const summary = deriveCallSummary({ brainState: state });
  const derived = deriveCallResolution({ brainState: state });
  const toolFlags = toolFlagsFromBrain(state);
  const review = row.stored.owner_review && row.stored.owner_review.reason ? row.stored.owner_review : null;
  const callerTurns = row.turns.map((t) => t.caller);
  const merged = review
    ? mergeTranscriptReview({ derived, summary, toolFlags, review, callerTurns })
    : null;
  return { row, state, summary, derived, merged, rows };
}

// ----------------------------------------------------------- per-call owner text

// [id, hangup reason off, owner reason off, hangup reason on, owner reason on, topic on]
const OWNER_TEXT = [
  [
    'HD_73fa119a7435',
    "Alvin asked about We're leaving.",
    "Alvin asked about We're leaving.",
    'Alvin asked about carpet cleaning.',
    'Alvin wanted to book carpet cleaning.',
    'carpet cleaning',
  ],
  [
    'HD_c19044667595',
    'Alvin asked about Just leave it at that.',
    'Alvin asked about Just leave it at that.',
    'Alvin asked about a previous booking.',
    'Alvin asked about a previous booking.',
    'a previous booking',
  ],
  [
    'HD_b401138c8ffd',
    'Caller asked about kumweka booking for tomorrow,.',
    'Tomorrow. No name.',
    'Caller asked about booking a visit.',
    'Caller wanted to book a visit for tomorrow.',
    'booking a visit',
  ],
  [
    'HD_f9b67efaf590',
    'Caller asked about Niulize, ni services gani mna- mna offer.',
    'Caller asked about apartment cleaning services.',
    'Caller asked about the services you offer.',
    'Caller asked about apartment cleaning services.',
    'the services you offer',
  ],
  [
    'HD_740090e11a2f',
    'Caller asked about Chris.',
    'Caller asked about Chris and requested directions.',
    'Caller asked for Chris (Manager). They also asked about directions to the shop.',
    'Caller asked for Chris (Manager) and requested directions.',
    'directions to the shop',
  ],
  [
    'HD_e6d2aca7886c',
    'Chris left a hold. From began yellow',
    'Chris wanted to order a long list of items.',
    'Chris left an enquiry; the item was not clear.',
    'Chris wanted to order a long list of items.',
    'placing an order',
  ],
  [
    'HD_ad735da7fb01',
    'Alvin called.',
    'Carpet cleaning. No name.',
    'Alvin called. No clear ask.',
    'Alvin wanted to know the price for carpet cleaning.',
    null,
  ],
];

describe('18 Oct: owner text from the topic, never the caller words', () => {
  for (const [id, hangOff, ownerOff, hangOn, ownerOn, topicOn] of OWNER_TEXT) {
    it(`${id} off: today's text (stored owner reason)`, () =>
      withFlag(null, () => {
        const out = replay(id);
        assert.equal(out.summary.reason, hangOff);
        assert.equal(out.merged.reason, ownerOff);
        assert.equal(out.row.stored.owner_review.reason, ownerOff);
        assert.equal('topic' in out.summary, false);
        assert.equal('topic' in out.merged, false);
      }));

    it(`${id} on: readable owner text and summary.topic`, () =>
      withFlag('on', () => {
        const out = replay(id);
        assert.equal(out.summary.reason, hangOn);
        assert.equal(out.merged.reason, ownerOn);
        assert.equal(out.summary.topic, topicOn);
        assert.doesNotMatch(out.merged.reason, /No name/);
        assert.doesNotMatch(out.merged.want, /No name|We're leaving|leave it at that/);
      }));
  }

  it('HD_dfd531f8b083 (no review): hangup line off reads the whole list; on names the order', () => {
    withFlag(null, () => {
      const out = replay('HD_dfd531f8b083');
      assert.match(out.summary.reason, /^Do I need left a hold\. Cartons 10 JK copy paper, pens za Damasa 20/);
      assert.equal(out.row.stored.reason, out.summary.reason);
    });
    withFlag('on', () => {
      const out = replay('HD_dfd531f8b083');
      assert.equal(out.summary.reason, 'Do I need left an enquiry about JK copy paper and more.');
      assert.equal(out.summary.topic, 'JK copy paper and more');
      assert.equal(out.summary.topicSource, 'saved_row');
    });
  });
});

// ------------------------------------------------------------- 3. goal capture

describe('18 Oct: goal capture', () => {
  it('a leave-off is never a goal (on); isClosingCue is unchanged', () =>
    withFlag('on', () => {
      for (const text of ["We're leaving", 'Just leave it at that.', 'Okay, never mind.', 'Achana nayo', 'Wacha tu']) {
        assert.equal(fixesD199.notAGoal(text), true, text);
        assert.equal(fixesD199.isClosingCue(text), false, text);
      }
      for (const text of ['Leave it at the gate', 'I want to leave a message', 'Carpet cleaning tomorrow']) {
        assert.equal(fixesD199.notAGoal(text), false, text);
      }
    }));

  it('HD_73fa119a7435: after the name is bound, "We going through?" / "We\'re leaving" keep the carpet ask', () => {
    withFlag(null, () => assert.equal(replay('HD_73fa119a7435').state.goal.description, "We're leaving"));
    withFlag('on', () =>
      assert.match(replay('HD_73fa119a7435').state.goal.description, /Carpet Cleaning details/));
  });

  it('HD_740090e11a2f: a bare team name is the person asked for, not the goal', () => {
    withFlag(null, () => {
      const out = replay('HD_740090e11a2f');
      assert.equal(out.state.goal.description, 'Chris');
      assert.equal(out.state.conversation.personAsked, undefined);
    });
    withFlag('on', () => {
      const out = replay('HD_740090e11a2f');
      assert.notEqual(out.state.goal.description, 'Chris');
      assert.deepEqual(out.state.conversation.personAsked, { name: 'Chris', role: 'Manager' });
      assert.equal(out.state.conversation.askedForPerson, true);
      assert.deepEqual(toolFlagsFromBrain(out.state).personAsked, { name: 'Chris', role: 'Manager' });
    });
  });

  it('a team name given when we asked for theirs is the caller, not a person asked for', () =>
    withFlag('on', () => {
      let state = createBrainState(ESGA);
      state = observeCallerTurn(state, { text: 'Chris.', profile: ESGA, lastAgentText: 'May I have your name, please?' });
      assert.equal(state.conversation.personAsked, undefined);
      assert.notEqual(state.conversation.askedForPerson, true);
    }));

  it('team names: bare or "is X there", titles dropped; other words are not a name', () => {
    const people = topics.teamPeople(ESGA);
    assert.equal(people.length, 4);
    assert.ok(people.every((p) => !('phone' in p)));
    assert.deepEqual(topics.teamPersonNamed('Chris.', people), { name: 'Chris', role: 'Manager' });
    assert.deepEqual(topics.teamPersonNamed('Is Chris there?', people), { name: 'Chris', role: 'Manager' });
    assert.deepEqual(topics.teamPersonNamed('Esther', people), { name: 'Madam Esther', role: 'Business owner' });
    assert.equal(topics.teamPersonNamed('Christmas', people), null);
    assert.equal(topics.teamPersonNamed('Naitwa Chris', people), null);
    assert.equal(topics.teamPersonNamed('Chris wa wapi leo jamani', people), null);
  });
});

// --------------------------------------------------- 1. summary.topic contract

describe('18 Oct: summary.topic order of sources and null', () => {
  const visit = { action: 'create_appointment', status: 'succeeded', value: { serviceName: 'Sofa Cleaning (per seat)' } };
  const enquiry = (item) => ({ action: 'create_service_request', status: 'succeeded', requestType: 'enquiry', value: { item } });

  it('1 saved row: visit service, then a readable request item; a list is named by its first item', () => {
    assert.deepEqual(topics.summaryTopic({ results: [visit], hits: ['Carpet Cleaning (per room)'], intent: 'price' }), {
      topic: 'sofa cleaning',
      source: 'saved_row',
    });
    assert.deepEqual(topics.summaryTopic({ results: [enquiry('Long list of stationery items'), enquiry('From began yellow')] }), {
      topic: 'long list of stationery items',
      source: 'saved_row',
    });
    assert.equal(topics.summaryTopic({ results: [enquiry('Cartons 10 JK copy paper, pens za Damasa 20, erasers')] }).topic, 'JK copy paper and more');
  });

  it('2 catalogue name the caller said; 3 intent label; 4 null', () => {
    assert.deepEqual(topics.summaryTopic({ hits: ['Carpet Cleaning (per room)'], intent: 'price' }), {
      topic: 'carpet cleaning',
      source: 'catalogue',
    });
    // A service word in the held goal; never the sentence around it.
    assert.deepEqual(topics.summaryTopic({ goal: 'Like, the dishwashing one. Do you remember?', intent: 'general_enquiry' }), {
      topic: 'dishwashing',
      source: 'catalogue',
    });
    assert.deepEqual(topics.summaryTopic({ intent: 'hours_open' }), { topic: 'your opening hours', source: 'intent' });
    assert.deepEqual(topics.summaryTopic({ intent: 'human', person: { name: 'Chris', role: 'Manager' } }), {
      topic: 'speaking to Chris',
      source: 'intent',
    });
    assert.deepEqual(topics.summaryTopic({ results: [enquiry('From began yellow')], intent: 'general_enquiry' }), {
      topic: null,
      source: null,
    });
  });

  it('catalogue hits need every distinctive word; Swahili nouns map', () => {
    const names = topics.catalogueTopicNames(DND);
    assert.deepEqual(topics.catalogueHits('Eeh, Carpet', names), ['Carpet Cleaning (per room)']);
    assert.deepEqual(topics.catalogueHits('magodoro', names), ['Mattress cleaning']);
    assert.deepEqual(topics.catalogueHits('usafi wa apartment', names), []);
  });

  it('writeReviewedSummary writes summary.topic and owner_review.topic (on); nothing new off', async () => {
    const dbPath = require.resolve('../src/db');
    const prev = require.cache[dbPath];
    const patches = [];
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        mergeCallSummaryMeta: async ({ patch }) => patches.push(patch),
        setCallResolution: async () => {},
      },
    };
    try {
      const { writeReviewedSummary } = require('../src/conversation/callTranscriptReview');
      const base = { reason: 'Caller asked about carpet cleaning.', want: 'x', done: 'None.', mood: 'calm', next: 'None.', applied: { reason: true } };
      await writeReviewedSummary({ callSid: 'HD_x', merged: { ...base, topic: 'carpet cleaning' }, review: {}, derived: {}, summary: {} });
      await writeReviewedSummary({ callSid: 'HD_y', merged: base, review: {}, derived: {}, summary: {} });
      assert.equal(patches[0].topic, 'carpet cleaning');
      assert.equal(patches[0].owner_review.topic, 'carpet cleaning');
      assert.equal('topic' in patches[1], false);
      assert.equal('topic' in patches[1].owner_review, false);
    } finally {
      if (prev) require.cache[dbPath] = prev;
      else delete require.cache[dbPath];
    }
  });

  it('a review that changes only the topic is still saved (on)', async () =>
    withFlagAsync('on', async () => {
      let saved = null;
      const out = await runPostCallTranscriptReview(
        {
          callSid: 'HD_topic',
          turns: [
            { speaker: 'caller', text: 'Do you clean carpets in Nakuru town?' },
            { speaker: 'agent', text: 'Yes we do.' },
          ],
          // Sweep shape: no hangup topic stored, so the intent label.
          summary: { reason: 'Caller asked about carpet cleaning.' },
          derived: { resolution: 'resolved', primaryIntent: 'price' },
          toolFlags: {},
        },
        {
          generateText: async () =>
            JSON.stringify({ reason: 'x', want: '', done: '', next: '', mood: 'unknown', needs_human: false, needs_owner: false, urgent: false, confidence: 0.2, primary_intent: 'price' }),
          save: async ({ merged }) => {
            saved = merged;
          },
          waitMs: 0,
          retryMs: 0,
        }
      );
      assert.equal(out.ok, true);
      assert.ok(saved, 'saved');
      assert.equal(saved.topic, 'prices');
      assert.equal(saved.applied.topic, true);
    }));
});

// ------------------------------------------------------ 2. unfinished want

describe('18 Oct: unfinished visit want is a sentence', () => {
  const review = { reason: 'Tomorrow. No name.', want: '', done: '', next: '', mood: 'calm', confidence: 0.9, needs_human: true, primary_intent: 'book_visit' };
  const flags = { intent: 'book_visit', when: 'tomorrow', visitAsk: true };
  const derived = { resolution: 'needs_human', primaryIntent: 'book_visit' };

  it('off: "Tomorrow. No name."', () =>
    withFlag(null, () => {
      const out = mergeTranscriptReview({ derived, summary: {}, toolFlags: flags, review });
      assert.equal(out.reason, 'Tomorrow. No name.');
    }));

  it('on: "Caller wanted to book a visit for tomorrow."; the service and place when held', () =>
    withFlag('on', () => {
      const out = mergeTranscriptReview({ derived, summary: {}, toolFlags: flags, review });
      assert.equal(out.reason, 'Caller wanted to book a visit for tomorrow.');
      const built = mergeTranscriptReview({
        derived,
        summary: {},
        toolFlags: { ...flags, callerName: 'Alvin', service: 'Carpet Cleaning (per room)' },
        review: { ...review, want: 'Alvin wanted to know the price for carpet cleaning.' },
      });
      assert.equal(built.reason, 'Alvin wanted to book carpet cleaning for tomorrow.');
      // No service entity: the catalogue topic from the hangup summary.
      const fromTopic = mergeTranscriptReview({
        derived,
        summary: { topic: 'sofa cleaning', topicSource: 'catalogue' },
        toolFlags: { ...flags, place: 'Runda' },
        review,
      });
      assert.equal(fromTopic.reason, 'Caller wanted to book sofa cleaning in Runda for tomorrow.');
    }));

  it('on: all slots held is not the unfinished path; the reviewer sentence beats an intent label', () =>
    withFlag('on', () => {
      const full = mergeTranscriptReview({
        derived,
        summary: {},
        toolFlags: { ...flags, callerName: 'Alvin', service: 'Carpet Cleaning (per room)', place: 'Nakuru' },
        review: { ...review, want: 'Alvin wanted to know the price for carpet cleaning.' },
      });
      assert.equal(full.reason, 'Alvin wanted to know the price for carpet cleaning.');
    }));
});

// ----------------------------------------------------- 4. asked for a person

describe('18 Oct: asked for <name> (<role>)', () => {
  it('rewrites "asked about Chris" and "asked for Chris" once', () => {
    const chris = { name: 'Chris', role: 'Manager' };
    assert.equal(topics.askedForPerson('Caller asked about Chris.', chris), 'Caller asked for Chris (Manager).');
    assert.equal(topics.askedForPerson('Caller asked for Chris (Manager).', chris), 'Caller asked for Chris (Manager).');
    assert.equal(topics.askedForPerson('Caller asked about Christmas hours.', chris), 'Caller asked about Christmas hours.');
  });
});

// ------------------------------------------------- 5. saved request quantity/item

describe('18 Oct: saved request quantity and enquiry item', () => {
  const list = 'Cartons 10 JK copy paper, pens za Damasa 20, erasers za Nataraj 15, counter book, dollar pens boxes 3';
  const opts = { productCatalog: ESGA.productCatalog };

  it('off: "Mbalimbali" and the garbled item are saved as said', () =>
    withFlag(null, () => {
      const a = validateServiceRequest({ type: 'enquiry', name: 'Jane Doe', item: list, quantity: 'Mbalimbali' }, opts);
      assert.equal(a.value.quantity, 'Mbalimbali');
      const b = validateServiceRequest({ type: 'enquiry', name: 'Jane Doe', item: 'From began yellow' }, opts);
      assert.equal(b.value.item, 'From began yellow');
    }));

  it('on: non-count quantity and list quantity are empty (saved null); counts stay', () =>
    withFlag('on', () => {
      assert.equal(validateServiceRequest({ type: 'enquiry', name: 'Jane Doe', item: list, quantity: 'Mbalimbali' }, opts).value.quantity, '');
      assert.equal(validateServiceRequest({ type: 'enquiry', name: 'Jane Doe', item: 'Kasuku A5', quantity: 'various' }, opts).value.quantity, '');
      assert.equal(validateServiceRequest({ type: 'enquiry', name: 'Jane Doe', item: 'Kasuku A5', quantity: '3 boxes' }, opts).value.quantity, '3 boxes');
      assert.equal(validateServiceRequest({ type: 'enquiry', name: 'Jane Doe', item: 'Kasuku A5', quantity: 'dazeni mbili' }, opts).value.quantity, 'dazeni mbili');
    }));

  it('on: a garbled enquiry item becomes "Item not captured", the words kept in notes', () =>
    withFlag('on', () => {
      const out = validateServiceRequest(
        { type: 'enquiry', name: 'Jane Doe', item: 'From began yellow', notes: 'Caller mentioned from began yellow for long order list' },
        opts
      );
      assert.equal(out.valid, true);
      assert.equal(out.value.item, 'Item not captured');
      assert.match(out.value.notes, /^Caller words: From began yellow\./);
      const ok = validateServiceRequest({ type: 'enquiry', name: 'Jane Doe', item: 'Long list of stationery items' }, opts);
      assert.equal(ok.value.item, 'Long list of stationery items');
    }));
});

// --------------------------------------------------- 6. mood and call_facts

describe('18 Oct: mood urgent and call_facts agree with the merged review', () => {
  it('HD_740090e11a2f: mood urgent with urgent=false is unknown (on), urgent (off)', () => {
    withFlag(null, () => assert.equal(replay('HD_740090e11a2f').merged.mood, 'urgent'));
    withFlag('on', () => {
      assert.equal(replay('HD_740090e11a2f').merged.mood, 'unknown');
      const out = mergeTranscriptReview({
        derived: { resolution: 'needs_human', primaryIntent: 'emergency' },
        summary: {},
        toolFlags: {},
        review: { reason: 'Caller reported a burst pipe flooding the kitchen.', mood: 'urgent', urgent: true, confidence: 0.9 },
      });
      assert.equal(out.mood, 'urgent');
    });
    assert.equal(normalizeMood('urgent'), 'urgent');
  });

  const facts = (intent, outcome) => ({
    intent,
    outcome,
    secondary_intents: [],
    products_mentioned: [],
    lost_reason: null,
    price_objection: false,
    objection_price_ksh: null,
    competitor_mentioned: null,
    est_value_ksh: null,
    caller_area: null,
    language: 'en',
    sentiment: 'neutral',
    unanswered_question: null,
  });
  const row = (f, merged, review = {}) =>
    buildCallFactsRow({ call: { id: 'c', tenant_id: 't', created_at: '2026-10-15T20:53:55Z' }, facts: f, review, catalogue: [], merged });

  it('off: raw model facts', () =>
    withFlag(null, () => {
      const out = row(facts('book_visit', 'info_only'), { resolution: 'needs_human', primaryIntent: 'book_visit' });
      assert.equal(out.outcome, 'info_only');
    }));

  it('on: needs a person -> callback; resolved -> not callback; abandoned -> abandoned; human_request only when asked', () =>
    withFlag('on', () => {
      // HD_73fa119a7435
      assert.equal(row(facts('book_visit', 'info_only'), { resolution: 'needs_human', primaryIntent: 'book_visit' }).outcome, 'callback');
      // HD_f9b67efaf590 (merged resolved)
      assert.equal(row(facts('general_enquiry', 'callback'), { resolution: 'resolved', primaryIntent: 'general_enquiry' }).outcome, 'info_only');
      assert.equal(row(facts('general_enquiry', 'info_only'), { resolution: 'abandoned', primaryIntent: null }).outcome, 'abandoned');
      assert.equal(row(facts('hold_or_pickup', 'hold'), { resolution: 'abandoned', primaryIntent: 'hold_or_pickup' }).outcome, 'hold');
      const notAsked = row(facts('human_request', 'callback'), { resolution: 'needs_human', primaryIntent: 'book_visit', reviewKind: 'book_visit' });
      assert.equal(notAsked.intent, 'book_visit');
      // HD_740090e11a2f: the caller asked for Chris.
      const asked = row(facts('human_request', 'callback'), { resolution: 'needs_human', primaryIntent: 'human' }, { primary_intent: 'human' });
      assert.equal(asked.intent, 'human_request');
      assert.equal(asked.outcome, 'callback');
    }));
});

// ------------------------------------------------- seed / instruction policies

describe('18 Oct: starter and receptionist-instruction policy lines are not facts', () => {
  const policies = ESGA_SNAPSHOT.tenant.business_policies;

  it('Esga (no meta rows): off keeps warranty and cancellation instructions as facts; on drops them', () => {
    withFlag(null, () => {
      const split = provenance.factPolicyMap(policies, null);
      assert.ok(split.policies.warranty);
      assert.ok(split.policies.cancellation);
      assert.equal(split.policies.payment, undefined); // exact starter, already dropped
    });
    withFlag('on', () => {
      const split = provenance.factPolicyMap(policies, null);
      assert.equal(split.policies.warranty, undefined);
      assert.equal(split.policies.cancellation, undefined);
      assert.ok(split.unknown.includes('Warranty'));
      assert.ok(split.unknown.includes('Cancellation'));
      assert.ok(split.policies.other, 'owner text stays');
    });
  });

  it('near-duplicate starter text (punctuation and a word changed) is seed (on only)', () => {
    const near = 'Same day Nairobi delivery for stocked items when available, countrywide shipping on request!';
    const edited = 'Same-day Nairobi delivery for all stocked items when available; countrywide shipping on request.';
    withFlag(null, () => {
      assert.equal(provenance.isSeedPolicyText(near), true); // punctuation only: exact after norm
      assert.equal(provenance.isSeedPolicyText(edited), false);
    });
    withFlag('on', () => {
      assert.equal(provenance.isSeedPolicyText(edited), true);
      assert.equal(provenance.isSeedPolicyText('Delivery within Nakuru town same day, KES 200.'), false);
    });
  });

  it('an owner meta row still wins over the heuristic', () =>
    withFlag('on', () => {
      const meta = provenance.indexFieldMeta([{ field_path: 'policies.warranty', source: 'owner' }]);
      const split = provenance.factPolicyMap(policies, meta);
      assert.ok(split.policies.warranty);
    }));
});

it('summary.topic: a clock ask is "what time it is"; an hours ask is not (#734 HD_95e6745c0df1)', () => {
  const { summaryTopic } = require('../src/conversation/ownerTopic');
  assert.equal(summaryTopic({ goal: 'What time is it' }).topic, 'what time it is');
  assert.equal(summaryTopic({ goal: 'Ni saa ngapi sasa?' }).topic, 'what time it is');
  assert.equal(summaryTopic({ goal: 'Mnafungua saa ngapi?' }).topic, null);
});
