// Run: node tests/actionProgress.test.js
const assert = require('assert');
const {
  pickActionProgress,
  pickClarifyProgress,
  pickContextualAck,
  pickLlmRecoveryLine,
  pickLlmRecoverySaved,
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
assert.equal(looksLikeCallerName('Carpet cleaning'), false);
assert.equal(looksLikeCallerName('Pardon?'), false);
assert.equal(looksLikeCallerName('sema tena'), false);

console.log('actionProgress tests passed.');
