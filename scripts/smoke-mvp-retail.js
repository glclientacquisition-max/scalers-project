#!/usr/bin/env node
/**
 * MVP retail Brain smoke (no network).
 * Exercises the frozen MVP path: intent → NBA → validated tools → summary.
 * Beachhead scenarios mirror docs/MVP_SHIP_AND_TEST.md.
 */

const {
  createBrainState,
  inferIntent,
  observeCallerTurn,
  setNextBestAction,
  recordActionResults,
} = require('../src/conversation/brainState');
const {
  extractConversationEntities,
  entityValue,
} = require('../src/conversation/entityExtraction');
const {
  buildBrainCapabilities,
} = require('../src/conversation/brainPolicy');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../src/conversation/toolExecution');
const {
  selectProductsForTurn,
  formatTargetedProductsForPrompt,
} = require('../src/conversation/productCatalog');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const {
  ensureRequiredEscalate,
} = require('../src/conversation/requiredEscalate');
const { deriveCallSummary } = require('../src/conversation/callSummary');

const catalog = [
  {
    name: 'Rich Dad Poor Dad',
    category: 'Financial Education',
    price: '900',
    aliases: ['rich dad'],
  },
  {
    name: 'The Smart Money Tribe',
    category: 'Financial Education',
    price: '',
  },
  {
    name: 'Harry Potter Series',
    category: 'Children',
    price: '1200',
  },
  {
    name: 'Outwitting the Devil',
    category: 'Financial Education',
    price: '',
  },
];

const profile = {
  vertical: 'retail',
  productCatalog: catalog,
  businessLocations: [
    { label: 'City Market', address: 'Muindi Mbingu Street', landmark: 'near City Market' },
  ],
  agentTools: { escalate: true, end_call: true },
};

const capabilities = buildBrainCapabilities(profile, {
  createServiceRequest: true,
  liveTransfer: false,
});

function runTurn(state, text) {
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
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
    entities,
    profile,
  });
  const decision = determineNextBestAction({ state: next, capabilities });
  next = setNextBestAction(next, decision);
  return { state: next, decision };
}

/** @type {Array<{ name: string, run: () => Promise<void>|void }>} */
const scenarios = [
  {
    name: 'Hours → ANSWER, no lead capture',
    run() {
      const { state, decision } = runTurn(createBrainState(profile), 'Are you open tomorrow?');
      assert.equal(state.intent, 'hours');
      assert.equal(decision.action, 'ANSWER');
      assert.equal(state.caller.name, null);
    },
  },
  {
    name: 'Location → ANSWER',
    run() {
      const { state, decision } = runTurn(createBrainState(profile), 'Where are you located?');
      assert.equal(state.intent, 'location');
      assert.equal(decision.action, 'ANSWER');
    },
  },
  {
    name: 'Listed price → ANSWER with catalogue product',
    run() {
      const { state, decision } = runTurn(
        createBrainState(profile),
        'How much is Rich Dad Poor Dad?'
      );
      assert.equal(state.intent, 'price');
      assert.equal(entityValue(state.entities.product), 'Rich Dad Poor Dad');
      assert.equal(decision.action, 'ANSWER');
    },
  },
  {
    name: 'Philosophy recommend → CATEGORY MISS (no Finance bleed)',
    run() {
      const text = 'Can you recommend a philosophy book?';
      const { state } = runTurn(createBrainState(profile), text);
      assert.equal(state.intent, 'product_inquiry');
      const matches = selectProductsForTurn({
        catalog,
        queryText: text,
        intent: state.intent,
      });
      assert.equal(matches.length, 0);
      const block = formatTargetedProductsForPrompt(matches, {
        totalCatalogSize: catalog.length,
        queryText: text,
        catalog,
      });
      assert.match(block, /CATEGORY MISS/i);
      assert.doesNotMatch(block, /Outwitting the Devil/);
    },
  },
  {
    name: 'Children ask → only Children category',
    run() {
      const matches = selectProductsForTurn({
        catalog,
        queryText: "I'd like children books",
        intent: 'order',
      });
      assert.ok(matches.length >= 1);
      assert.ok(matches.every((p) => /Children/i.test(p.category)));
    },
  },
  {
    name: 'Hold with catalogue title succeeds',
    async run() {
      const parsed = parseGeminiResponse(
        '###TOOL###{"create_service_request":{"type":"hold","name":"Jane","item":"rich dad","when_text":"tomorrow 5pm"}}###ENDTOOL###'
      );
      let saved = null;
      const execution = await executeBrainTools({
        parsed,
        capabilities,
        productCatalog: catalog,
        handlers: {
          createServiceRequest: async (request) => {
            saved = request;
            return { id: 'h1', request_type: request.type };
          },
        },
      });
      assert.equal(execution.results[0].status, 'succeeded');
      assert.equal(saved.item, 'Rich Dad Poor Dad');
      assert.match(formatToolConfirmation(execution.results, 'en'), /saved/i);
    },
  },
  {
    name: 'Hold / order missing catalogue title → enquiry path',
    async run() {
      for (const type of ['hold', 'order']) {
        const when =
          type === 'hold'
            ? ',"when_text":"tomorrow 5pm"'
            : '';
        const parsed = parseGeminiResponse(
          `###TOOL###{"create_service_request":{"type":"${type}","name":"Jane","item":"Atomic Habits"${when}}}###ENDTOOL###`
        );
        const execution = await executeBrainTools({
          parsed,
          capabilities,
          productCatalog: catalog,
          handlers: {
            createServiceRequest: async () => ({ id: 'nope' }),
          },
        });
        assert.equal(execution.results[0].status, 'invalid');
        assert.equal(execution.results[0].code, 'catalog_miss');
      }
    },
  },
  {
    name: 'Manager + name → ESCALATE; inject if model skips marker',
    async run() {
      let state = createBrainState(profile);
      ({ state } = runTurn(state, 'I want to speak to the manager'));
      assert.equal(state.intent, 'human');
      ({ state } = runTurn(state, 'My name is Brian'));
      const decision = determineNextBestAction({ state, capabilities });
      assert.equal(decision.action, 'ESCALATE');
      state = setNextBestAction(state, decision);

      const injected = ensureRequiredEscalate(
        { spokenText: 'You can WhatsApp us', escalate: null },
        state,
        capabilities
      );
      assert.equal(injected.escalate.name, 'Brian');

      let escalated = false;
      const execution = await executeBrainTools({
        parsed: injected,
        capabilities,
        handlers: {
          escalate: async () => {
            escalated = true;
            return { ok: true, channel: 'whatsapp' };
          },
        },
      });
      assert.equal(escalated, true);
      assert.equal(execution.results.find((r) => r.action === 'escalate')?.status, 'succeeded');
    },
  },
  {
    name: 'Backchannel keeps product_inquiry; fragment is not a name',
    run() {
      let state = createBrainState(profile);
      ({ state } = runTurn(state, 'Can you recommend a philosophy book?'));
      assert.equal(state.intent, 'product_inquiry');
      ({ state } = runTurn(state, 'uh-huh'));
      assert.equal(state.intent, 'product_inquiry');

      let human = createBrainState(profile);
      ({ state: human } = runTurn(human, 'I want to speak to the manager'));
      const entities = extractConversationEntities("I'd like to discuss—", {
        intent: 'human',
        state: human,
      });
      human = observeCallerTurn(human, {
        text: "I'd like to discuss—",
        detectedLanguage: 'en',
        resolvedLanguage: 'en',
        entities,
        profile,
      });
      assert.equal(human.intent, 'human');
      assert.equal(human.caller.name, null);
    },
  },
  {
    name: 'Desk summary prefers human + drops fragment names',
    run() {
      let state = observeCallerTurn(createBrainState(profile), {
        text: 'I want to speak to the manager',
        detectedLanguage: 'en',
        resolvedLanguage: 'en',
      });
      state.intent = 'general_enquiry';
      state.handoff.requested = true;
      state.caller.name = "I'd like to discuss—";
      state.goal.description = 'uh-huh';
      const summary = deriveCallSummary({ brainState: state });
      assert.equal(summary.primaryIntent, 'human');
      assert.equal(summary.callerName, null);
    },
  },
  {
    name: 'Unknown catalogue price stays empty (do not invent)',
    run() {
      const matches = selectProductsForTurn({
        catalog,
        queryText: 'How much is The Smart Money Tribe?',
        intent: 'price',
        entities: {
          product: { value: 'The Smart Money Tribe', confirmed: true },
        },
      });
      assert.equal(matches[0].name, 'The Smart Money Tribe');
      assert.equal(matches[0].price, '');
      const block = formatTargetedProductsForPrompt(matches);
      assert.match(block, /Price: unknown/i);
    },
  },
];

const assert = {
  equal(a, b) {
    if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  ok(v) {
    if (!v) throw new Error('expected truthy');
  },
  match(s, re) {
    if (!re.test(String(s))) throw new Error(`expected match ${re}: ${s}`);
  },
  doesNotMatch(s, re) {
    if (re.test(String(s))) throw new Error(`expected no match ${re}: ${s}`);
  },
};

async function main() {
  let failed = 0;
  for (const s of scenarios) {
    try {
      await s.run();
      console.log('OK', s.name);
    } catch (err) {
      failed += 1;
      console.error('FAIL', s.name, err?.message || err);
    }
  }
  if (failed) {
    console.error(`\n${failed} MVP scenario(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${scenarios.length} MVP scenarios passed.`);
}

main();
