const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { inferIntent, createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { polishSpokenReply } = require('../src/conversation/dynamicSpeech');
const { prepareStreamedSpeech } = require('../src/conversation/callCorrectives');
const { planEmptyGeminiSpeech } = require('../src/conversation/dynamicSpeech');

const homeCard = {
  name: 'Amina',
  sharedLine: true,
  greetByName: false,
  alternateNames: ['Brian'],
  nextAppointment: 'carpet, Thursday 10 AM',
  recentBookings: ['couch cleaning, 3 March'],
};

const retailCard = {
  name: 'Esga',
  sharedLine: false,
  greetByName: false,
  openRequests: ['3 diaries, Friday'],
};

function homeState(text, card = homeCard) {
  return observeCallerTurn(createBrainState({ vertical: 'home_services', callerMemory: card }), {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
    profile: { vertical: 'home_services', callerMemory: card },
  });
}

function reply(text, state) {
  return resolveLocalReply({
    text,
    state,
    profile: { vertical: state.vertical, callerMemory: homeCard },
    language: state.language?.current || 'en',
  });
}

describe('file read is not a new job', () => {
  const homeAsks = [
    'Which bookings do you have?',
    "Uh, Shy, let's check for me the previous booking.",
    'For me which booking I have, yaani.',
    'read for me.',
    'The one that I have.',
    'Which ones do I have in place? Can you read it for me?',
    'Is there any that I have in place?',
    'I just want to know which ones I have.',
  ];

  for (const text of homeAsks) {
    it(`home services stays honest for: ${text}`, () => {
      assert.equal(inferIntent(text, { vertical: 'home_services' }), 'general_enquiry');
      const state = homeState(text);
      const local = reply(text, state);
      assert.equal(local, null);
      const decision = determineNextBestAction({
        state,
        capabilities: { createAppointment: true, saveCallerInfo: true },
      });
      assert.equal(decision.action, 'ANSWER');
      assert.notEqual(decision.slot, 'service');
      assert.match(decision.reason, /Do not list services/i);
      assert.match(decision.reason, /Do not invent/i);
    });
  }

  it('does not steal a real home visit book', () => {
    const text = 'Book carpet cleaning tomorrow in Rongai. I am Alvin.';
    assert.equal(inferIntent(text, { vertical: 'home_services' }), 'booking');
    const state = homeState(text);
    assert.equal(reply(text, state), null);
  });

  it('does not steal a reschedule of a visit they named', () => {
    const text = 'Can you reschedule my visit to Tuesday?';
    assert.equal(inferIntent(text, { vertical: 'home_services' }), 'cancellation');
  });

  it('backend reads a bound home file instead of leaving it to the model', () => {
    const card = {
      name: 'Alex',
      sharedLine: false,
      greetByName: true,
      identityBound: true,
      fileRole: 'primary',
      nextAppointment: 'carpet, Tuesday 10 AM',
    };
    const state = observeCallerTurn(
      createBrainState({ vertical: 'home_services', callerMemory: card }),
      {
        text: 'What are my bookings?',
        detectedLanguage: 'en',
        resolvedLanguage: 'en',
        profile: { vertical: 'home_services', callerMemory: card },
      }
    );
    const local = reply('What are my bookings?', state);
    assert.equal(local, null);
    assert.equal(state.conversation.fileReadSentence, 'You have carpet, Tuesday 10 AM.');
    assert.doesNotMatch(state.conversation.fileReadSentence, /these visits|something specific/i);
  });

  it('says so in Kiswahili when a bound home file is empty', () => {
    const card = {
      name: 'Amina',
      identityBound: true,
      fileRole: 'primary',
      openVisits: [],
      openRequests: [],
      recentBookings: [],
    };
    const profile = { vertical: 'home_services', callerMemory: card };
    const state = observeCallerTurn(createBrainState(profile), {
      text: 'Niambie booking yangu.',
      profile,
      detectedLanguage: 'sw',
      resolvedLanguage: 'sw',
    });
    const local = resolveLocalReply({
      text: 'Niambie booking yangu.',
      state,
      profile,
      language: 'sw',
    });
    assert.equal(local, null);
    assert.equal(state.conversation.fileReadSentence, 'Hakuna kilicho wazi.');
    assert.notEqual(state.conversation.fileReadSentence, 'Sina booking yako.');
  });

  const retailAsks = [
    'What do I have on hold?',
    'Read my order.',
    'Which holds do I have?',
    'Is there any order I have?',
  ];

  for (const text of retailAsks) {
    it(`retail stays honest for: ${text}`, () => {
      assert.notEqual(inferIntent(text, { vertical: 'retail' }), 'order');
      assert.notEqual(inferIntent(text, { vertical: 'retail' }), 'booking');
      const state = observeCallerTurn(createBrainState({ vertical: 'retail', callerMemory: retailCard }), {
        text,
        detectedLanguage: 'en',
        resolvedLanguage: 'en',
        profile: { vertical: 'retail', callerMemory: retailCard },
      });
      const local = resolveLocalReply({
        text,
        state,
        language: 'en',
        profile: { vertical: 'retail' },
      });
      assert.equal(local, null);
    });
  }

  it('does not steal a real retail order', () => {
    const text = 'I want to order 3 diaries.';
    assert.equal(inferIntent(text, { vertical: 'retail' }), 'order');
    const state = observeCallerTurn(createBrainState({ vertical: 'retail' }), {
      text,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile: { vertical: 'retail' },
    });
    assert.equal(
      resolveLocalReply({ text, state, language: 'en', profile: { vertical: 'retail' } }),
      null
    );
  });

  it('answers the catalogue from the file', () => {
    const text = 'What services do you offer?';
    assert.equal(looksLikeOffer(text), true);
    const state = homeState(text);
    const local = resolveLocalReply({
      text,
      state,
      language: 'en',
      profile: {
        vertical: 'home_services',
        servicesCatalog: [
          { name: 'Couch cleaning' },
          { name: 'Mattress cleaning' },
          { name: 'Carpet cleaning' },
        ],
      },
    });
    assert.equal(local.outcome, 'catalogue');
    assert.equal(
      local.line,
      'We offer Couch cleaning, Mattress cleaning, and Carpet cleaning. Which one do you need?'
    );
    assert.equal(looksLikeOffer('Maybe you can tell me the services that you have'), true);
    assert.equal(looksLikeOffer('So uniambie services mko nayo'), true);
  });

  it('strips an unasked menu and an invented file before it is spoken', () => {
    const menu = polishSpokenReply(
      'Areyou looking to get your carpet, couch, mattress, or house cleaned?',
      {
        state: homeState('Mm-hm.'),
        callerTurns: ['Mm-hm.'],
        language: 'en',
      }
    );
    assert.match(menu, /carpet/i);
    assert.match(menu, /couch/i);
    assert.match(menu, /mattress/i);
    assert.match(prepareStreamedSpeech('Areyou looking'), /Are you looking/);

    const invented = polishSpokenReply('Would you like to reschedule or cancel any of them?', {
      state: homeState('Which ones do I have in place?'),
      callerTurns: ['Which ones do I have in place?'],
      language: 'en',
    });
    assert.equal(invented, '');
    assert.notEqual(invented, "I don't have a booking for you.");

    const oneService = polishSpokenReply('We can do couch cleaning.', {
      state: homeState('How much for couch cleaning?'),
      callerTurns: ['How much for couch cleaning?'],
      language: 'en',
    });
    assert.match(oneService, /couch cleaning/i);
  });

  it('keeps the empty file true on the next sentence, and strips a later invention', () => {
    const card = {
      name: 'Alvin',
      identityBound: true,
      fileRole: 'primary',
      openVisits: [],
      openRequests: [],
      recentBookings: [],
    };
    const profile = { vertical: 'home_services', callerMemory: card };
    let state = observeCallerTurn(createBrainState(profile), {
      text: 'Can you tell me my booking?',
      profile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(reply('Can you tell me my booking?', state), null);
    assert.equal(state.conversation.fileReadSentence, 'Nothing is still open.');
    assert.equal(state.conversation.toldNothingOnFile, true);
    state = observeCallerTurn(state, {
      text: 'Really?',
      profile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(reply('Really?', state), null);
    assert.equal(state.conversation.fileReadSentence, 'Nothing is still open.');
    assert.notEqual(state.conversation.fileReadSentence, "I don't have a booking for you.");
    state = observeCallerTurn(state, {
      text: 'Which one is it?',
      profile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(reply('Which one is it?', state), null);
    assert.equal(state.conversation.fileReadSentence, 'Nothing is still open.');
    state = observeCallerTurn(state, {
      text: "You're failing me.",
      profile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(reply("You're failing me.", state), null);
    assert.equal(state.conversation.fileReadSentence, 'Nothing is still open.');
    assert.equal(reply('How much for couch cleaning?', state), null);
    assert.equal(reply('What services do you offer?', state).outcome, 'catalogue');

    const invented = polishSpokenReply("Is there anything you'd like to change about it?", {
      state,
      callerTurns: ['Really?'],
      language: 'en',
    });
    assert.equal(invented, 'Nothing is still open.');
    assert.notEqual(invented, "I don't have a booking for you.");

    const greeting = polishSpokenReply(
      'Nzuri sana. Nikupe usaidizi gani kuhusu booking yako leo?',
      { state, callerTurns: ['Habari yako?'], language: 'sw' }
    );
    assert.match(greeting, /Nzuri sana/);
    assert.doesNotMatch(greeting, /booking yako/i);

    const retailInvented = polishSpokenReply('Would you like to cancel that order?', {
      state: observeCallerTurn(createBrainState({ vertical: 'retail' }), {
        text: 'Read my order.',
        detectedLanguage: 'en',
        resolvedLanguage: 'en',
        profile: { vertical: 'retail' },
      }),
      callerTurns: ['Really?'],
      language: 'en',
    });
    assert.equal(retailInvented, '');
    assert.notEqual(retailInvented, "I don't have an order or a hold for you.");
  });

  it('uses the honest line instead of sorry-say-that-again on a file read', () => {
    const card = {
      name: 'Alvin',
      identityBound: true,
      fileRole: 'primary',
      openVisits: [],
      openRequests: [],
      recentBookings: [],
    };
    const planned = planEmptyGeminiSpeech({
      brainState: createBrainState({ vertical: 'home_services', callerMemory: card }),
      language: 'en',
      userText: 'Read them for me.',
      llmDown: false,
      alreadyOffered: true,
    });
    assert.equal(planned.kind, 'file_read');
    assert.equal(planned.line, 'Nothing is still open.');
    assert.doesNotMatch(planned.line, /say that again/i);
  });
});

function looksLikeOffer(text) {
  const { looksLikeOfferAsk } = require('../src/conversation/fileRead');
  return looksLikeOfferAsk(text);
}
