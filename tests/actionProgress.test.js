// Run: node tests/actionProgress.test.js
const assert = require('assert');
const {
  pickActionProgress,
  pickClarifyProgress,
  pickContextualAck,
  pickLlmRecoveryLine,
  pickLlmRecoverySaved,
  pickSpeechGuaranteeLine,
  shouldSpeakHandoffNameAsk,
  looksLikeCallerName,
  looksLikePhaticCallerTurn,
  shouldSpeakThinkingAck,
  pickPhaticReply,
  looksLikeSpokenServiceDump,
  trimSpokenServiceDump,
  stripSpokenHedges,
  polishSpokenReply,
} = require('../src/conversation/dynamicSpeech');

assert.strictEqual(pickActionProgress('CREATE_REQUEST', 'en'), 'Okay.');
assert.strictEqual(pickActionProgress('CAPTURE', 'en'), 'Okay.');
assert.strictEqual(pickActionProgress('ESCALATE', 'en'), 'Okay.');
assert.strictEqual(pickActionProgress('TRANSFER', 'en'), 'Okay.');
assert.equal(pickActionProgress('CREATE_REQUEST', 'sw'), 'Sawa.');
assert.equal(pickActionProgress('ESCALATE', 'mixed'), 'Sawa.');
assert.equal(pickPhaticReply({ language: 'mixed' }), 'Nzuri, asante. Naweza kusaidia?');
assert.ok(pickContextualAck('I want to order a book', 'en'));
assert.equal(looksLikePhaticCallerTurn('How are you doing?'), true);
assert.equal(looksLikePhaticCallerTurn('How are you doing, Shy?'), true);
assert.equal(looksLikePhaticCallerTurn('hello'), true);
assert.equal(looksLikePhaticCallerTurn('how much for a couch?'), false);
assert.equal(looksLikePhaticCallerTurn("I'm okay"), true);
assert.equal(looksLikePhaticCallerTurn("I'm fine thanks"), true);
assert.equal(looksLikePhaticCallerTurn('I am good'), true);
// Live miss HD_d0f042f5d960 / HD_391a57aae9e9: closer Okay. is not how-are-you.
assert.equal(looksLikePhaticCallerTurn('Okay.'), false);
assert.equal(looksLikePhaticCallerTurn('ok'), false);
assert.equal(looksLikePhaticCallerTurn('okay thanks'), false);
assert.equal(looksLikePhaticCallerTurn('fine'), false);
assert.equal(looksLikePhaticCallerTurn('great'), false);
assert.equal(shouldSpeakThinkingAck('How are you doing?'), false);
assert.equal(shouldSpeakThinkingAck('How are you doing, Shy?'), false);
assert.equal(shouldSpeakThinkingAck('How much for a couch?'), true);
assert.equal(shouldSpeakThinkingAck('Okay.'), true);
assert.equal(pickPhaticReply({ language: 'en' }), "I'm well, thanks. How can I help?");
assert.equal(pickPhaticReply({ language: 'sw' }), 'Nzuri, asante. Naweza kusaidia?');
assert.equal(
  pickPhaticReply({
    language: 'en',
    callerMemory: { nextAppointment: 'carpet, Tuesday', greetByName: true },
  }),
  "I'm well. Who is calling?"
);
assert.equal(
  pickPhaticReply({
    language: 'en',
    callerMemory: {
      nextAppointment: 'carpet, Tuesday',
      greetByName: true,
      identityBound: true,
      fileRole: 'primary',
    },
  }),
  "I'm well. I have your visit on file. Is that why you called?"
);
assert.equal(
  pickPhaticReply({
    language: 'en',
    callerMemory: { sharedLine: true, name: 'Amina' },
  }),
  "I'm well. Who is calling?"
);
assert.doesNotMatch(pickPhaticReply({ language: 'en' }), /carpet|couch|mattress/i);
assert.equal(
  looksLikeSpokenServiceDump(
    "I'm doing well, thank you! We specialize in couch, carpet, and mattress cleaning."
  ),
  true
);
assert.equal(
  trimSpokenServiceDump(
    "I'm doing well, thank you! We specialize in couch, carpet, and mattress cleaning."
  ),
  'We can help with that. What do you need done?'
);
assert.equal(stripSpokenHedges('Let me check. We are open until 6.'), 'We are open until 6.');
assert.equal(stripSpokenHedges('One moment please.'), 'Okay.');
assert.equal(stripSpokenHedges('Sawa nakucheckia.', { language: 'sw' }), 'Sawa.');
assert.equal(
  polishSpokenReply('Okay, one moment. We are open until 6 PM.'),
  'We are open until 6 PM.'
);
assert.equal(
  polishSpokenReply(
    'ASR_CORRECTION_PROMPT: The user\'s input seems truncated or quiet. RETOTI: Sawa, Alvin.'
  ),
  'Sawa, Alvin.'
);
assert.equal(
  looksLikeSpokenServiceDump('We clean carpets. What time works?'),
  false
);
assert.match(
  pickClarifyProgress({
    action: 'ASK_CLARIFICATION',
    slot: 'name',
    intent: 'human',
    language: 'en',
  }),
  /name/i
);
assert.match(
  pickClarifyProgress({
    action: 'ASK_CLARIFICATION',
    slot: 'name',
    intent: 'human',
    language: 'sw',
  }),
  /jina/i
);
assert.doesNotMatch(
  pickClarifyProgress({
    action: 'ASK_CLARIFICATION',
    slot: 'name',
    intent: 'human',
    language: 'en',
  }),
  /[—–]/
);
const recoveryEn = pickLlmRecoveryLine({ language: 'en' });
const recoveryEnAgain = pickLlmRecoveryLine({ language: 'en', alreadyOffered: true });
const recoverySavedEn = pickLlmRecoverySaved({ language: 'en' });
const handoffNameEn = pickClarifyProgress({
  action: 'ASK_CLARIFICATION',
  slot: 'name',
  intent: 'human',
  language: 'en',
});
assert.strictEqual(
  recoveryEn,
  "Okay, I can't finish that just now. May I have your name so I can reach them?"
);
assert.strictEqual(
  recoveryEnAgain,
  "Okay, I still can't finish that. May I have your name so I can reach them?"
);
assert.ok(
  recoveryEn.includes(handoffNameEn.replace(/^Okay\.\s*/, '')),
  'recovery must reuse the handoff name ask'
);
assert.doesNotMatch(recoveryEn, /cannot|on this line|technical issue/i);
assert.doesNotMatch(recoveryEnAgain, /cannot|on this line|we will call you back/i);
assert.doesNotMatch(recoveryEn, /[—–]/);
assert.ok(recoveryEn.split(/\s+/).length <= 25);
assert.ok(recoveryEnAgain.split(/\s+/).length <= 25);
assert.strictEqual(
  recoverySavedEn,
  "Okay, I have your name. I'll have the team reach you."
);
assert.match(pickLlmRecoveryLine({ language: 'sw' }), /jina/i);
assert.doesNotMatch(pickLlmRecoveryLine({ language: 'sw' }), /simu hii/i);
assert.equal(looksLikeCallerName('Ann Wanjiku'), true);
assert.equal(looksLikeCallerName('My name is Alvin'), true);
assert.equal(looksLikeCallerName('Carpet cleaning'), false);
assert.equal(looksLikeCallerName('Pardon?'), false);
assert.equal(looksLikeCallerName('sema tena'), false);

// Live miss HD_b4cb560bae33 / Alvin 2026-09-19: empty Gemini ANSWER must not
// speak the Gemini-down reach-them name-ask when the caller already named themselves.
assert.equal(
  shouldSpeakHandoffNameAsk({
    nextBestAction: { action: 'ASK_CLARIFICATION', slot: 'name' },
    brainState: {
      intent: 'human',
      caller: { name: 'Alvin' },
      goal: { missingSlots: ['name'] },
    },
    userText: "Yeah, I'm Alvin.",
  }),
  false
);
assert.equal(
  shouldSpeakHandoffNameAsk({
    nextBestAction: { action: 'ASK_CLARIFICATION', slot: 'name' },
    brainState: { intent: 'human', goal: { missingSlots: ['name'] } },
    userText: 'Can I speak to someone?',
  }),
  true
);

const emptyAnswerAfterName = pickSpeechGuaranteeLine({
  nextBestAction: { action: 'ANSWER' },
  brainState: {
    intent: 'booking',
    caller: { name: 'Alvin' },
    goal: { missingSlots: ['name'] },
  },
  language: 'en',
  userText: "Yeah, I'm Alvin.",
});
assert.doesNotMatch(emptyAnswerAfterName, /can't finish/i);
assert.doesNotMatch(emptyAnswerAfterName, /name so I can reach them/i);
assert.match(emptyAnswerAfterName, /day and time|time works/i);

const nextWhenSlot = pickSpeechGuaranteeLine({
  nextBestAction: { action: 'ASK_CLARIFICATION', slot: 'when' },
  brainState: {
    intent: 'booking',
    caller: { name: 'Alvin' },
    goal: { missingSlots: ['when'] },
  },
  language: 'en',
  userText: 'Carpet cleaning Thursday',
});
assert.match(nextWhenSlot, /day and time|time works/i);
assert.doesNotMatch(nextWhenSlot, /can't finish|reach them/i);

const landmarkSlot = pickClarifyProgress({
  action: 'ASK_CLARIFICATION',
  slot: 'landmark',
  language: 'en',
});
assert.match(landmarkSlot, /landmark/i);
assert.doesNotMatch(landmarkSlot, /[—–]/);

assert.match(
  pickSpeechGuaranteeLine({
    nextBestAction: { action: 'ANSWER' },
    brainState: { intent: 'hours' },
    language: 'en',
    userText: 'Are you open?',
  }),
  /^Okay\.?$/i
);

// Live leftover HD_bc9f610692de: bookings ask after the name was already in
// must not speech-guarantee another name ask.
assert.doesNotMatch(
  pickSpeechGuaranteeLine({
    nextBestAction: { action: 'ASK_CLARIFICATION', slot: 'name' },
    brainState: {
      intent: 'booking',
      caller: { name: 'Alvin', nameConfirmed: true },
      goal: { missingSlots: ['name'] },
    },
    language: 'en',
    userText: 'What are my bookings?',
  }),
  /May I have your name/i
);

console.log('actionProgress tests passed.');
