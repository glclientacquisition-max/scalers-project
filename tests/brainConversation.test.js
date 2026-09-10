const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createBrainState,
  inferIntent,
  observeCallerTurn,
  setNextBestAction,
  formatBrainStateForPrompt,
} = require('../src/conversation/brainState');
const { extractConversationEntities, entityValue } = require('../src/conversation/entityExtraction');
const { buildBrainCapabilities } = require('../src/conversation/brainPolicy');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const {
  analyzeCallerLanguage,
  createLanguageState,
  resolveLanguageState,
} = require('../src/conversation/language');
const { buildBrainTrace } = require('../src/conversation/brainObservability');

const profile = {
  vertical: 'retail',
  productCatalog: [
    { name: 'HP Printer', aliases: ['HP DeskJet'], price: '15,000', in_stock: 'yes' },
    { name: 'USB-C Charger', aliases: ['charger'], price: '1,500', in_stock: 'yes' },
  ],
  servicesCatalog: [{ name: 'Printer repair' }],
  businessLocations: [
    { label: 'Westlands', address: 'Westlands Square' },
    { label: 'CBD', address: 'Muindi Mbingu Street' },
  ],
  agentTools: { escalate: true, end_call: true },
};

const capabilities = buildBrainCapabilities(profile, {
  createServiceRequest: true,
  liveTransfer: false,
});

function runTurn(state, languageState, text, lastAgentText = '', opts = {}) {
  const activeProfile = opts.profile || profile;
  const activeCapabilities = opts.capabilities || capabilities;
  const evidence = analyzeCallerLanguage(text);
  const nextLanguage = resolveLanguageState(languageState, evidence);
  const provisionalIntent = inferIntent(text);
  const entityIntent =
    provisionalIntent === 'general_enquiry' && state.goal.status === 'active'
      ? state.intent
      : provisionalIntent;
  const entities = extractConversationEntities(text, {
    profile: activeProfile,
    intent: entityIntent,
    state,
  });
  let next = observeCallerTurn(state, {
    text,
    languageState: nextLanguage,
    entities,
    profile: activeProfile,
    lastAgentText,
  });
  const decision = determineNextBestAction({ state: next, capabilities: activeCapabilities });
  next = setNextBestAction(next, decision);
  return { state: next, languageState: nextLanguage, decision };
}

describe('multi-turn Brain outcomes', () => {
  it('answers a grounded price without collecting a lead', () => {
    const turn = runTurn(
      createBrainState(profile),
      createLanguageState(),
      'How much is the HP printer?'
    );
    assert.equal(turn.state.intent, 'price');
    assert.equal(entityValue(turn.state.entities.product), 'HP Printer');
    assert.deepEqual(turn.state.goal.missingSlots, []);
    assert.equal(turn.decision.action, 'ANSWER');
    assert.equal(turn.state.caller.name, null);
  });

  it('asks for only the missing product, then resumes the price goal', () => {
    let state = createBrainState(profile);
    let languageState = createLanguageState();
    let turn = runTurn(state, languageState, 'How much is it?');
    assert.equal(turn.decision.action, 'ASK_CLARIFICATION');
    assert.equal(turn.decision.slot, 'subject');

    ({ state, languageState } = turn);
    turn = runTurn(state, languageState, 'HP printer');
    assert.equal(turn.state.intent, 'price');
    assert.equal(entityValue(turn.state.entities.product), 'HP Printer');
    assert.deepEqual(turn.state.goal.missingSlots, []);
    assert.equal(turn.decision.action, 'ANSWER');
  });

  it('collects hold slots one at a time before creating a request', () => {
    let state = createBrainState(profile);
    let languageState = createLanguageState();
    let turn = runTurn(state, languageState, 'Please hold a charger for me');
    assert.equal(turn.state.intent, 'hold');
    assert.deepEqual(turn.state.goal.missingSlots, ['name', 'when']);
    assert.equal(turn.decision.slot, 'name');

    ({ state, languageState } = turn);
    turn = runTurn(state, languageState, 'Jane');
    assert.equal(entityValue(turn.state.entities.name), 'Jane');
    assert.deepEqual(turn.state.goal.missingSlots, ['when']);
    assert.equal(turn.decision.slot, 'when');

    ({ state, languageState } = turn);
    turn = runTurn(state, languageState, 'Tomorrow at 5 PM');
    assert.deepEqual(turn.state.goal.missingSlots, []);
    assert.equal(turn.decision.action, 'CREATE_REQUEST');
  });

  it('asks which branch only when multiple locations exist', () => {
    let state = createBrainState(profile);
    let languageState = createLanguageState();
    let turn = runTurn(state, languageState, 'Where are you located?');
    assert.deepEqual(turn.state.goal.missingSlots, ['branch']);
    assert.equal(turn.decision.action, 'ASK_CLARIFICATION');

    ({ state, languageState } = turn);
    turn = runTurn(state, languageState, 'Westlands');
    assert.equal(entityValue(turn.state.entities.branch), 'Westlands');
    assert.equal(turn.decision.action, 'ANSWER');
  });

  it('progresses repair from contextual clarification to human', () => {
    let state = createBrainState(profile);
    let languageState = createLanguageState();
    let turn = runTurn(state, languageState, 'How much is the HP printer?');

    ({ state, languageState } = turn);
    turn = runTurn(state, languageState, "That's not what I meant");
    assert.equal(turn.state.repair.failureCount, 1);
    assert.equal(turn.decision.action, 'APOLOGIZE_AND_REPAIR');

    ({ state, languageState } = turn);
    turn = runTurn(state, languageState, 'No, not that one');
    assert.equal(turn.state.repair.failureCount, 2);
    assert.equal(turn.decision.action, 'APOLOGIZE_AND_REPAIR');

    ({ state, languageState } = turn);
    turn = runTurn(state, languageState, 'You misunderstood me');
    assert.equal(turn.state.repair.failureCount, 3);
    assert.equal(turn.decision.action, 'ESCALATE');
  });

  it('does not escalate a resolvable complaint merely because the caller is upset', () => {
    const turn = runTurn(
      createBrainState(profile),
      createLanguageState(),
      'I am upset, this is the wrong price'
    );
    assert.equal(turn.state.intent, 'price');
    assert.notEqual(turn.decision.action, 'ESCALATE');
  });

  it('keeps language sticky until switch evidence is strong', () => {
    let languageState = resolveLanguageState(
      createLanguageState(),
      analyzeCallerLanguage('Hello, I need the price please')
    );
    assert.equal(languageState.current, 'en');

    languageState = resolveLanguageState(
      languageState,
      analyzeCallerLanguage('sawa')
    );
    assert.equal(languageState.current, 'en');
    assert.equal(languageState.pending, 'sw');

    languageState = resolveLanguageState(
      languageState,
      analyzeCallerLanguage('Nataka kujua bei gani tafadhali')
    );
    assert.equal(languageState.current, 'sw');
    assert.equal(languageState.switchCount, 1);
  });

  it('does not put caller name or phone into structured traces', () => {
    const state = createBrainState(profile);
    state.entities = {
      name: { value: 'Jane', source: 'caller_explicit', confirmed: true },
      phone: { value: '0712345678', source: 'caller_explicit', confirmed: true },
      product: { value: 'HP Printer', source: 'tenant_product_catalog', confirmed: true },
    };
    const trace = buildBrainTrace({ callSid: 'call_1', state });
    assert.equal(trace.entities.name, undefined);
    assert.equal(trace.entities.phone, undefined);
    assert.equal(trace.entities.product.value, 'HP Printer');
    assert.doesNotMatch(JSON.stringify(trace), /Jane|0712345678/);
  });

  it('classifies booking with landmark as booking intent, not location', () => {
    assert.equal(
      inferIntent(
        'I want to book carpet cleaning for tomorrow at 10 AM. My name is Alex, and my landmark is Barnabas.'
      ),
      'booking'
    );
    assert.equal(
      inferIntent('book carpet cleaning tomorrow at 10 AM for Alex at Barnabas'),
      'booking'
    );
    const turn = runTurn(
      createBrainState(profile),
      createLanguageState(),
      'I want to book carpet cleaning for tomorrow at 10 AM. My name is Alex, and my landmark is Barnabas.'
    );
    assert.equal(turn.state.intent, 'booking');
  });

  it('does not treat a hear-again as a caller name or a save', () => {
    const homeProfile = {
      vertical: 'home_services',
      servicesCatalog: [{ name: 'Carpet cleaning', price_range: '1,500-2,000' }],
      agentTools: { escalate: true, end_call: true },
    };
    const homeCapabilities = buildBrainCapabilities(homeProfile);
    let turn = runTurn(
      createBrainState(homeProfile),
      createLanguageState(),
      'I want to book carpet cleaning for tomorrow at 10 AM',
      '',
      { profile: homeProfile, capabilities: homeCapabilities }
    );
    assert.equal(turn.state.intent, 'booking');
    assert.ok(turn.state.goal.missingSlots.includes('name'));
    assert.equal(turn.decision.action, 'ASK_CLARIFICATION');
    assert.equal(turn.decision.slot, 'name');

    ({ state: turn.state, languageState: turn.languageState } = turn);
    turn = runTurn(turn.state, turn.languageState, 'Pardon?', '', {
      profile: homeProfile,
      capabilities: homeCapabilities,
    });
    assert.equal(turn.state.intent, 'booking');
    assert.equal(entityValue(turn.state.entities.name), '');
    assert.ok(turn.state.goal.missingSlots.includes('name'));
    assert.equal(turn.decision.action, 'ASK_CLARIFICATION');
    assert.notEqual(turn.decision.action, 'CREATE_REQUEST');
    assert.equal(turn.state.conversation.hearAgain, true);
    const prompt = formatBrainStateForPrompt(turn.state);
    assert.match(prompt, /Hear-again/);
    assert.match(prompt, /Do not save/);
  });

  it('does not complete a booking when hear-again follows a late-night time', () => {
    const homeProfile = {
      vertical: 'home_services',
      servicesCatalog: [{ name: 'Carpet cleaning', price_range: '1,500-2,000' }],
      agentTools: { escalate: true, end_call: true },
    };
    const homeCapabilities = buildBrainCapabilities(homeProfile);
    let turn = runTurn(
      createBrainState(homeProfile),
      createLanguageState(),
      'I want to book carpet cleaning for tomorrow at 10 PM',
      '',
      { profile: homeProfile, capabilities: homeCapabilities }
    );
    assert.equal(turn.state.intent, 'booking');
    assert.ok(entityValue(turn.state.entities.when));
    assert.ok(turn.state.goal.missingSlots.includes('name'));

    ({ state: turn.state, languageState: turn.languageState } = turn);
    turn = runTurn(turn.state, turn.languageState, 'Pardon?', '', {
      profile: homeProfile,
      capabilities: homeCapabilities,
    });
    assert.equal(entityValue(turn.state.entities.name), '');
    assert.ok(turn.state.goal.missingSlots.includes('name'));
    assert.ok(turn.state.goal.missingSlots.includes('landmark'));
    assert.equal(turn.decision.action, 'ASK_CLARIFICATION');
    assert.notEqual(turn.decision.action, 'CREATE_REQUEST');
  });

  it('does not require a landmark for retail booking', () => {
    const turn = runTurn(
      createBrainState(profile),
      createLanguageState(),
      'Book printer repair tomorrow at 10 AM. My name is Alex.'
    );
    assert.equal(turn.state.intent, 'booking');
    assert.equal(turn.state.goal.missingSlots.includes('landmark'), false);
    assert.equal(turn.decision.action, 'CREATE_REQUEST');
  });

  it('requires a landmark before home-services booking can save', () => {
    const homeProfile = {
      vertical: 'home_services',
      servicesCatalog: [{ name: 'Carpet cleaning', price_range: '1,500-2,000' }],
      agentTools: { escalate: true, end_call: true },
    };
    const homeCapabilities = buildBrainCapabilities(homeProfile);
    let turn = runTurn(
      createBrainState(homeProfile),
      createLanguageState(),
      'Book carpet cleaning tomorrow at 10 AM. My name is Alex.',
      '',
      { profile: homeProfile, capabilities: homeCapabilities }
    );
    assert.equal(turn.state.intent, 'booking');
    assert.ok(turn.state.goal.missingSlots.includes('landmark'));
    assert.equal(turn.decision.action, 'ASK_CLARIFICATION');

    ({ state: turn.state, languageState: turn.languageState } = turn);
    turn = runTurn(turn.state, turn.languageState, 'Landmark is Barnabas', '', {
      profile: homeProfile,
      capabilities: homeCapabilities,
    });
    assert.equal(entityValue(turn.state.entities.landmark), 'Barnabas');
    assert.deepEqual(turn.state.goal.missingSlots, []);
    assert.equal(turn.decision.action, 'CREATE_REQUEST');
  });

  it('classifies transfer and connect requests as human intent', () => {
    const turn1 = runTurn(createBrainState(profile), createLanguageState(), 'Connect me to Alvin');
    assert.equal(turn1.state.intent, 'human');
    const turn2 = runTurn(createBrainState(profile), createLanguageState(), 'I want you to forward this call to Alvin');
    assert.equal(turn2.state.intent, 'human');
  });

  it('confirms then corrects the caller name before save_caller_info can persist it', async () => {
    const { executeBrainTools } = require('../src/conversation/toolExecution');
    const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
    let state = createBrainState(profile);
    let languageState = createLanguageState();
    let turn = runTurn(state, languageState, 'My name is Jane, how much is the HP printer?');
    assert.equal(turn.state.caller.name, 'Jane');
    assert.equal(turn.state.caller.nameConfirmed, false);
    assert.match(formatBrainStateForPrompt(turn.state), /Got it, Jane/);
    assert.equal(turn.decision.action, 'ANSWER');

    let saved = null;
    let early = await executeBrainTools({
      parsed: parseGeminiResponse(
        '###TOOL###{"save_caller_info":{"name":"Jane","reason":"price"}}###ENDTOOL###'
      ),
      capabilities: { saveCallerInfo: true },
      nameConfirmed: turn.state.caller.nameConfirmed,
      handlers: {
        saveCallerInfo: async (info) => {
          saved = info;
          return info;
        },
      },
    });
    assert.equal(early.results[0].status, 'deferred');
    assert.equal(saved, null);

    ({ state, languageState } = turn);
    turn = runTurn(state, languageState, 'No, it\'s James');
    assert.equal(turn.state.caller.name, 'James');
    assert.equal(turn.state.caller.nameConfirmed, true);
    assert.doesNotMatch(formatBrainStateForPrompt(turn.state), /this turn only/);

    const persisted = await executeBrainTools({
      parsed: parseGeminiResponse(
        '###TOOL###{"save_caller_info":{"name":"James","reason":"price"}}###ENDTOOL###'
      ),
      capabilities: { saveCallerInfo: true },
      nameConfirmed: turn.state.caller.nameConfirmed,
      handlers: {
        saveCallerInfo: async (info) => {
          saved = info;
          return info;
        },
      },
    });
    assert.equal(persisted.results[0].status, 'succeeded');
    assert.equal(saved.name, 'James');
  });
});
