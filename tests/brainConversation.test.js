const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createBrainState,
  inferIntent,
  observeCallerTurn,
  setNextBestAction,
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

function runTurn(state, languageState, text, lastAgentText = '') {
  const evidence = analyzeCallerLanguage(text);
  const nextLanguage = resolveLanguageState(languageState, evidence);
  const provisionalIntent = inferIntent(text);
  const entityIntent =
    provisionalIntent === 'general_enquiry' && state.goal.status === 'active'
      ? state.intent
      : provisionalIntent;
  const entities = extractConversationEntities(text, {
    profile,
    intent: entityIntent,
    state,
  });
  let next = observeCallerTurn(state, {
    text,
    languageState: nextLanguage,
    entities,
    profile,
    lastAgentText,
  });
  const decision = determineNextBestAction({ state: next, capabilities });
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
});
