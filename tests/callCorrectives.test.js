const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  createBrainState,
  observeCallerTurn,
  formatBrainStateForPrompt,
} = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const {
  extractConversationEntities,
  extractQuantity,
} = require('../src/conversation/entityExtraction');
const { ensureRequiredCreateRequest } = require('../src/conversation/requiredCreateRequest');
const { buildSystemPrompt } = require('../src/prompts');
const { formatAuthorityPolicy } = require('../src/conversation/brainPolicy');
const { formatHomeServicesPlaybookForPrompt } = require('../src/conversation/playbooks/homeServices');
const { formatRetailPlaybookForPrompt } = require('../src/conversation/playbooks/retail');
const { polishSpokenReply } = require('../src/conversation/dynamicSpeech');
const {
  looksLikeNonConsentAck,
  pickCorrectiveReply,
  prepareStreamedSpeech,
} = require('../src/conversation/callCorrectives');

const retail = { vertical: 'retail' };
const home = {
  vertical: 'home_services',
  businessPolicies: { delivery: 'Runda and Westlands' },
};

function say(state, text, profile) {
  const entities = extractConversationEntities(text, {
    profile,
    intent: state.intent && state.intent !== 'unknown' ? state.intent : 'general_enquiry',
    state,
  });
  return observeCallerTurn(state, {
    text,
    entities,
    profile,
    resolvedLanguage: 'en',
  });
}

describe('post-V5 call correctives', () => {
  it('does not turn Then. or Okay. into a quantity or a saved order', () => {
    assert.equal(looksLikeNonConsentAck('Then.'), true);
    assert.equal(looksLikeNonConsentAck('Okay.'), true);
    assert.equal(looksLikeNonConsentAck('Sawa'), true);
    assert.equal(looksLikeNonConsentAck('Tomorrow is okay.'), false);
    assert.equal(extractQuantity('Then.', 'order'), null);
    assert.equal(extractQuantity('Okay.', 'order'), null);
    assert.equal(extractQuantity('10 diaries', 'order'), '10');

    let state = createBrainState(retail);
    state = say(state, 'I want to order diaries', retail);
    state = say(state, 'This is Alvin', retail);
    state = say(state, 'Then.', retail);

    assert.equal(state.intent, 'order');
    assert.equal(state.entities.quantity, undefined);
    assert.equal(state.conversation.nonConsentAck, true);
    const decision = determineNextBestAction({
      state,
      capabilities: { createServiceRequest: true, escalate: true },
    });
    assert.equal(decision.action, 'ASK_CLARIFICATION');
    assert.equal(decision.slot, 'quantity');
    assert.match(decision.reason, /not a quantity/i);
    assert.match(decision.reason, /Do not invent a count/i);

    const line = pickCorrectiveReply({ text: 'Then.', state, language: 'en' });
    assert.match(line, /how many/i);
    assert.doesNotMatch(line, /\b10\b|saved|submit/i);

    const injected = ensureRequiredCreateRequest(
      {},
      { ...state, resolution: { nextBestAction: 'CREATE_REQUEST' }, goal: { missingSlots: [] } },
      { createServiceRequest: true }
    );
    assert.equal(injected.serviceRequest, undefined);

    const okay = say(state, 'Okay.', retail);
    const okayLine = pickCorrectiveReply({ text: 'Okay.', state: okay, language: 'en' });
    assert.match(okayLine, /how many/i);
    assert.doesNotMatch(okayLine, /\b10\b/);
    assert.equal(
      determineNextBestAction({
        state: okay,
        capabilities: { createServiceRequest: true },
      }).action,
      'ASK_CLARIFICATION'
    );
  });

  it('opens help after a name or vague small talk and does not pitch', () => {
    let state = createBrainState(retail);
    state = say(state, 'This is Alvin', retail);
    const named = pickCorrectiveReply({ text: 'This is Alvin', state, language: 'en' });
    assert.equal(named, 'How can I help?');
    assert.doesNotMatch(named, /order|whatsapp|diaries/i);

    state = say(createBrainState(home), "What's up for me?", home);
    const vague = pickCorrectiveReply({ text: "What's up for me?", state, language: 'en' });
    assert.equal(vague, 'How can I help?');
    assert.doesNotMatch(vague, /couch|mattress|carpet/);

    state = say(createBrainState(home), "Nothing much. I'm just asking.", home);
    const asking = pickCorrectiveReply({
      text: "Nothing much. I'm just asking.",
      state,
      language: 'en',
    });
    assert.equal(asking, 'How can I help?');
  });

  it('asks name then need on contact urgent and does not list services', () => {
    let state = say(createBrainState(home), 'Contact urgent.', home);
    assert.equal(state.intent, 'human');
    assert.ok(state.goal.missingSlots.includes('name'));
    assert.ok(state.goal.missingSlots.includes('reason'));
    const line = pickCorrectiveReply({ text: 'Contact urgent.', state, language: 'en' });
    assert.match(line, /name/i);
    assert.doesNotMatch(line, /couch|mattress|carpet|catalogue|catalog/i);
    const decision = determineNextBestAction({
      state,
      capabilities: { escalate: true },
    });
    assert.equal(decision.action, 'ASK_CLARIFICATION');
    assert.notEqual(decision.action, 'ESCALATE');
  });

  it('treats out-of-coverage leave-it as a callback note only', () => {
    let state = say(
      createBrainState(home),
      'Carpet cleaning tomorrow in Rongai, this is Alvin',
      home
    );
    state = say(state, 'Just leave it.', home);
    assert.equal(state.visitPlace.blocked, 'outside');
    assert.equal(state.conversation.leaveIt, true);
    const line = pickCorrectiveReply({ text: 'Just leave it.', state, language: 'en' });
    assert.match(line, /outside our coverage/i);
    assert.match(line, /callback/i);
    assert.doesNotMatch(line, /tomorrow|serving|saved|booked/i);
    const decision = determineNextBestAction({
      state,
      capabilities: { createAppointment: true },
    });
    assert.equal(decision.action, 'ANSWER');
    assert.match(decision.reason, /callback note only/i);
    const injected = ensureRequiredCreateRequest(
      {},
      { ...state, resolution: { nextBestAction: 'CREATE_REQUEST' }, goal: { missingSlots: [] } },
      { createAppointment: true }
    );
    assert.equal(injected.appointment, undefined);
  });

  it('does not lock an in-coverage visit on leave-it', () => {
    let state = say(
      createBrainState(home),
      'Carpet cleaning tomorrow at the Runda gate, this is Alvin',
      home
    );
    state = say(state, 'Okay, just leave it.', home);
    assert.notEqual(state.visitPlace && state.visitPlace.blocked, 'outside');
    const line = pickCorrectiveReply({ text: 'Okay, just leave it.', state, language: 'en' });
    assert.match(line, /not saved/i);
    assert.doesNotMatch(line, /look forward|serving you|tomorrow/i);
    const decision = determineNextBestAction({
      state,
      capabilities: { createAppointment: true },
    });
    assert.notEqual(decision.action, 'CREATE_REQUEST');
  });

  it('spaces glued speech and drops unsaved closes', () => {
    assert.equal(prepareStreamedSpeech('Howmany diaries would you like?'), 'How many diaries would you like?');
    assert.equal(prepareStreamedSpeech('Gotit, Alvin.'), 'Got it, Alvin.');
    assert.equal(prepareStreamedSpeech('I canhave our team contact you.'), 'I can have our team contact you.');
    assert.equal(prepareStreamedSpeech('I understandit is urgent.'), 'I understand it is urgent.');
    assert.equal(prepareStreamedSpeech('Whattime tomorrow would work?'), 'What time tomorrow would work?');
    assert.equal(prepareStreamedSpeech('Understood,Alvin.'), 'Understood, Alvin.');
    assert.equal(prepareStreamedSpeech('However, we can help.'), 'However, we can help.');
    const invented = prepareStreamedSpeech(
      'Got it, 10 diaries. I will submit this request for our team to send you a formal quote.'
    );
    assert.doesNotMatch(invented, /\b10\b|submit/i);
    const close = polishSpokenReply(
      'Understood,Alvin. We look forward to serving you tomorrow. Have a great day!'
    );
    assert.doesNotMatch(close, /serving you|tomorrow|great day/i);
    assert.match(formatBrainStateForPrompt(say(createBrainState(retail), 'Then.', retail)), /Acknowledgment only/);
  });

  it('encodes the six correctives in prompt and compile rules', () => {
    const prompt = buildSystemPrompt({ businessName: 'Done and Dusted', vertical: 'home_services' });
    assert.match(prompt, /Then, Okay, Ok, and Sawa are acknowledgments/);
    assert.match(prompt, /Do not pitch an order/);
    assert.match(prompt, /callback note/);
    assert.match(prompt, /contact urgent/i);
    assert.match(prompt, /complete words with spaces/);
    assert.match(formatAuthorityPolicy({}), /not a quantity/);
    assert.match(formatHomeServicesPlaybookForPrompt(), /callback note/);
    assert.match(formatHomeServicesPlaybookForPrompt(), /Do not invent areas/);
    assert.match(formatRetailPlaybookForPrompt(), /not a quantity/);
    const compiler = fs.readFileSync('dashboard/src/lib/promptCompiler.ts', 'utf8');
    const onboarding = fs.readFileSync('dashboard/src/lib/onboarding.ts', 'utf8');
    assert.match(compiler, /callback note only/);
    assert.match(compiler, /not a quantity and not a yes/);
    assert.match(onboarding, /Then, Okay, and Sawa are not a quantity/);
    assert.match(onboarding, /complete words with spaces/);
  });
});
