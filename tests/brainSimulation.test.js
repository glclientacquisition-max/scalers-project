// Offline call simulation against the Brain turn contract
// (docs/agents/BRAIN_TURN_CONTRACT.md). An adversarial Gemini stub leaks a
// price, a transfer, a coverage flip, a booking claim, and a stock count on
// every turn. The gates must strip all of it for every playbook. Any invariant
// violation fails the build.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createSimulator } = require('./helpers/brainSimulator');
const {
  createBrainState,
  observeCallerTurn,
  setNextBestAction,
} = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { buildBrainCapabilities } = require('../src/conversation/brainPolicy');
const { guardToolPlan } = require('../src/conversation/requiredCreateRequest');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');

const home = {
  vertical: 'home_services',
  businessName: 'Sparkle Cleaners',
  servicesCatalog: [
    { name: 'Carpet cleaning', price_range: '1,500-2,000' },
    { name: 'Sofa cleaning' },
    { name: 'Mattress cleaning' },
  ],
  businessPolicies: { delivery: 'Nairobi and Kitengela' },
  agentTools: { escalate: true, end_call: true },
};

const narrow = {
  ...home,
  businessPolicies: { delivery: 'Westlands and Kilimani' },
};

const retail = {
  vertical: 'retail',
  productCatalog: [
    { name: 'Diary', aliases: ['diaries'], price: '350', in_stock: 'yes' },
    { name: 'HP Printer', price: '15,000', in_stock: 'yes' },
  ],
  agentTools: { escalate: true, end_call: true },
};

const hospitality = { vertical: 'hospitality', agentTools: { escalate: true } };

function lines(sim) {
  return sim.turns.map((turn) => turn.agentLine);
}

function clean(sim) {
  assert.deepEqual(sim.violations, [], sim.transcript());
}

describe('brain simulation: home visit', () => {
  it('day-only "Tomorrow" climbs the time ladder then saves a callback note', async () => {
    const sim = createSimulator({ profile: home });
    await sim.run([
      'Hello, I need carpet cleaning tomorrow.',
      'Alvin.',
      'Kitengela, near Naivas.',
      'Tomorrow.',
      'Tomorrow.',
    ]);
    const spoken = lines(sim);
    assert.match(spoken[2], /what time tomorrow/i);
    assert.match(spoken[3], /morning or afternoon/i);
    assert.equal(sim.turns[4].toolResults.filter((r) => r.status === 'succeeded').length, 1);
    assert.equal(sim.saved.appointments.length, 0);
    assert.equal(sim.saved.serviceRequests.length, 1);
    const note = sim.saved.serviceRequests[0];
    assert.equal(note.type, 'callback');
    assert.match(note.notes, /Visit time to confirm/);
    assert.match(note.notes, /Kitengela/);
    clean(sim);
  });

  it('bare hour "12" is confirmed as noon before a calendar row exists', async () => {
    const sim = createSimulator({ profile: home });
    await sim.run([
      'I want sofa cleaning tomorrow in Kitengela near the stage.',
      'Mary.',
      '12',
      'Yes.',
    ]);
    const spoken = lines(sim);
    assert.match(spoken[2], /twelve noon\?/i);
    assert.equal(sim.saved.appointments.length, 1);
    assert.match(sim.saved.appointments[0].whenText, /tomorrow 12 pm/i);
    assert.equal(sim.saved.serviceRequests.length, 0);
    clean(sim);
  });

  it('out of coverage then "leave it" saves nothing and does not repeat the block', async () => {
    const sim = createSimulator({ profile: home });
    await sim.run(['Can you come to Rongai tomorrow for sofa cleaning?', 'Just leave it.']);
    const spoken = lines(sim);
    assert.match(spoken[0], /outside our coverage/i);
    assert.match(spoken[1], /nothing saved/i);
    assert.equal(sim.turns[1].outcome, 'leave_it');
    assert.equal(sim.saved.appointments.length, 0);
    assert.equal(sim.saved.serviceRequests.length, 0);
    clean(sim);
  });

  it('a landmark nobody can place gets one area question, never a refusal', async () => {
    const sim = createSimulator({ profile: narrow });
    await sim.run([
      'I need mattress cleaning tomorrow.',
      'Grace.',
      'Near the big church.',
      'Kilimani.',
      '10 in the morning.',
    ]);
    const spoken = lines(sim);
    assert.match(spoken[2], /which area/i);
    for (const line of spoken) assert.doesNotMatch(line, /outside our coverage/i);
    assert.equal(sim.saved.appointments.length, 1);
    assert.match(sim.saved.appointments[0].landmark, /Kilimani/);
    assert.match(sim.saved.appointments[0].landmark, /big church/i);
    clean(sim);
  });

  it('an unplaceable landmark is booked with a note after the area question, when the caller cannot say', async () => {
    const sim = createSimulator({ profile: narrow });
    await sim.run([
      'I need mattress cleaning tomorrow at 2 pm.',
      'Grace.',
      'Near the big church.',
      "I don't know the area.",
    ]);
    for (const line of lines(sim)) assert.doesNotMatch(line, /outside our coverage/i);
    assert.equal(sim.turns.filter((t) => /which area/i.test(t.agentLine)).length, 1);
    assert.equal(sim.saved.appointments.length, 1);
    assert.match(sim.saved.appointments[0].landmark, /big church/i);
    assert.doesNotMatch(sim.saved.appointments[0].landmark, /don't know/i);
    assert.match(sim.saved.appointments[0].notes, /area not confirmed/i);
    clean(sim);
  });
});

describe('brain simulation: retail order', () => {
  it('"Then." is not a quantity; the spoken count is saved once said', async () => {
    const sim = createSimulator({ profile: retail });
    await sim.run(['I want to order diaries.', 'Esga.', 'Then.', 'Five.']);
    const spoken = lines(sim);
    assert.match(spoken[2], /how many/i);
    assert.equal(sim.turns[2].toolResults.length, 0);
    assert.equal(sim.saved.serviceRequests.length, 1);
    assert.equal(sim.saved.serviceRequests[0].quantity, '5');
    assert.equal(sim.saved.serviceRequests[0].item, 'Diary');
    clean(sim);
  });

  it('"Okay" mid-order asks for the missing fact instead of saving', async () => {
    const sim = createSimulator({ profile: retail });
    await sim.run(['I want to order three diaries.', 'Okay.', 'Esga.']);
    assert.equal(sim.turns[1].toolResults.length, 0);
    assert.match(sim.turns[1].agentLine, /name/i);
    assert.equal(sim.saved.serviceRequests.length, 1);
    assert.equal(sim.saved.serviceRequests[0].quantity, '3');
    clean(sim);
  });
});

describe('brain simulation: human and urgent', () => {
  it('urgent contact collects name then need, escalates once, never claims a transfer', async () => {
    const sim = createSimulator({ profile: home });
    await sim.run(['Contact me urgently.', 'Dennis.', 'My pipe burst and the kitchen is flooding.']);
    const spoken = lines(sim);
    assert.match(spoken[0], /name/i);
    assert.match(spoken[1], /what do you need/i);
    assert.equal(sim.saved.escalations.length, 1);
    assert.equal(sim.saved.escalations[0].name, 'Dennis');
    assert.match(sim.saved.escalations[0].reason, /pipe burst/i);
    for (const line of spoken) assert.doesNotMatch(line, /transferring|stay on the line/i);
    clean(sim);
  });

  it('asking for the manager escalates with a name and no live-transfer promise', async () => {
    const sim = createSimulator({ profile: retail });
    await sim.run(['I want to speak to the manager about my refund.', 'Dennis.']);
    assert.equal(sim.saved.escalations.length, 1);
    assert.equal(sim.saved.escalations[0].name, 'Dennis');
    for (const line of lines(sim)) assert.doesNotMatch(line, /transferring|stay on the line/i);
    clean(sim);
  });
});

describe('brain simulation: facts', () => {
  it('a price not on file is never invented and gets an honest line', async () => {
    const sim = createSimulator({ profile: home });
    await sim.run(['How much is sofa cleaning?']);
    const line = sim.turns[0].agentLine;
    assert.doesNotMatch(line, /500/);
    assert.match(line, /don't have that on file/i);
    clean(sim);
  });

  it('hospitality with an empty profile speaks no invented counts', async () => {
    const sim = createSimulator({ profile: hospitality });
    await sim.run(['Do you have rooms tonight for 2 people?', 'How much per night?']);
    for (const line of lines(sim)) assert.doesNotMatch(line, /\b(500|7)\b/);
    clean(sim);
  });

  it('Swahili filler keeps the ask in Swahili and fires no tool', async () => {
    const sim = createSimulator({ profile: home });
    await sim.run(['Nataka usafi wa carpet kesho.', 'Sawa.']);
    assert.match(sim.turns[1].agentLine, /jina lako/i);
    assert.equal(sim.turns[1].toolResults.length, 0);
    assert.equal(sim.saved.serviceRequests.length + sim.saved.appointments.length, 0);
    clean(sim);
  });
});

describe('consent gate', () => {
  function stateAfter(texts, decisions, profile) {
    let state = createBrainState(profile);
    texts.forEach((text, i) => {
      const entities = extractConversationEntities(text, {
        profile,
        intent: state.intent === 'general_enquiry' ? 'order' : state.intent,
        state,
      });
      state = observeCallerTurn(state, { text, entities, profile, lastAgentText: '' });
      if (decisions[i]) state = setNextBestAction(state, decisions[i]);
    });
    return state;
  }

  it('"Okay" after "Should I continue?" is consent and keeps the tool', () => {
    const caps = buildBrainCapabilities(retail, { createServiceRequest: true });
    const state = stateAfter(
      ['I want to order three diaries, I am Esga.', 'Okay.'],
      [{ action: 'ASK_CLARIFICATION', slot: 'confirm' }],
      retail
    );
    assert.equal(state.conversation.consentAck, true);
    assert.equal(state.conversation.nonConsentAck, false);
    const decision = determineNextBestAction({ state, capabilities: caps });
    assert.notEqual(decision.slot, 'confirm');
    const plan = guardToolPlan(
      { serviceRequest: { type: 'order', name: 'Esga', item: 'Diary', quantity: '3' } },
      state,
      caps
    );
    assert.ok(plan.serviceRequest);
    assert.equal(plan.serviceRequest.quantity, '3');
  });

  it('"Okay" after any other question is a filler and drops the tool', () => {
    const caps = buildBrainCapabilities(retail, { createServiceRequest: true });
    const state = stateAfter(
      ['I want to order diaries.', 'Okay.'],
      [{ action: 'ASK_CLARIFICATION', slot: 'name' }],
      retail
    );
    assert.equal(state.conversation.consentAck, false);
    assert.equal(state.conversation.nonConsentAck, true);
    const plan = guardToolPlan(
      { serviceRequest: { type: 'order', name: 'Esga', item: 'Diary', quantity: '3' } },
      state,
      caps
    );
    assert.equal(plan.serviceRequest, undefined);
  });

  it('a quantity the caller only said in words survives the tool guard', () => {
    const caps = buildBrainCapabilities(retail, { createServiceRequest: true });
    const state = stateAfter(
      ['I want to order diaries.', 'Twenty please.'],
      [{ action: 'ASK_CLARIFICATION', slot: 'quantity' }],
      retail
    );
    const plan = guardToolPlan(
      { serviceRequest: { type: 'order', name: 'Esga', item: 'Diary', quantity: '20' } },
      state,
      caps
    );
    assert.equal(plan.serviceRequest.quantity, '20');
    const invented = guardToolPlan(
      { serviceRequest: { type: 'order', name: 'Esga', item: 'Diary', quantity: '40' } },
      state,
      caps
    );
    assert.equal(invented.serviceRequest.quantity, '');
  });
});

describe('speech gate', () => {
  const ctx = { callerTurns: ['I want twenty diaries'], profile: retail, language: 'en' };

  it('keeps numbers the caller or the file stated and drops the rest', () => {
    assert.equal(guardSpokenReply('Twenty diaries at 350 each.', ctx), 'Twenty diaries at 350 each.');
    assert.equal(guardSpokenReply('That is 20 diaries. It costs 500.', ctx), 'That is 20 diaries.');
    assert.equal(guardSpokenReply('One moment please.', ctx), 'One moment please.');
  });

  it('drops saved claims without a tool and transfer claims without live transfer', () => {
    assert.equal(guardSpokenReply("I've saved that. Anything else?", ctx), 'Anything else?');
    assert.equal(
      guardSpokenReply("Stay on the line, I'm transferring you now. May I have your name?", ctx),
      'May I have your name?'
    );
    assert.equal(
      guardSpokenReply("I've saved that.", { ...ctx, toolResults: [{ status: 'succeeded' }] }),
      "I've saved that."
    );
  });

  it('drops a coverage flip for a place outside the file', () => {
    const out = guardSpokenReply('We can definitely come to Runda. Where should we come?', {
      ...ctx,
      profile: narrow,
    });
    assert.equal(out, 'Where should we come?');
    const inside = guardSpokenReply('We can come to Westlands. What time?', { ...ctx, profile: narrow });
    assert.equal(inside, 'We can come to Westlands. What time?');
  });

  it('answers a price question honestly when the number had to be dropped', () => {
    const out = guardSpokenReply('It costs 500 shillings.', {
      ...ctx,
      callerTurns: ['How much is sofa cleaning?'],
      profile: home,
    });
    assert.match(out, /don't have that on file/i);
    assert.doesNotMatch(out, /500/);
  });
});
