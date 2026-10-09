// Text replay for the speak-DNA fails.
// HD_ad735: a file price was grounded, then the name ask was the only line.
// HD_993: "which service is you offer" must speak the Phase-0 list, not a label.
// HD_c705 / HD_708: name Yes after a public answer continues. It does not END
// and it does not re-list.
// HD_e3fb94e1bd0d: price ranges, the Kiswahili offer, and Nakuru stay.
// Deterministic. No model judge.
// Run: node --test tests/hdSpeakReplay.test.js

// Fixtures here use P0 owner rows (no value_hash). An ambient FACT_HASH_MODE=on
// in the shell must not flip them; hash-mode cases set the flag per test.
delete process.env.FACT_HASH_MODE;
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
// Picker lists carry an owner row (ownerCoverage). Bare Okay/Sawa consent and
// coverage lines with no list on file are the flag-off path (flagOff);
// BRAIN_CONFIRMED_COVERAGE=on twins: confirmedCoverage.test.js.
const { ownerCoverage, flagOff } = require('./helpers/ownerCoverage');
const fs = require('fs');
const path = require('path');
const { resolveLocalReply, planCallerModelTurn } = require('../src/conversation/turnPolicy');
const {
  createBrainState,
  observeCallerTurn,
  setNextBestAction,
} = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { planCatalogueMouth } = require('../src/speech/catalogueMouth');
const {
  polishSpokenReply,
  polishSpokenDetail,
  planEmptyGeminiSpeech,
  shouldSkipCallerTurn,
} = require('../src/conversation/dynamicSpeech');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { noteSpokenPendingAsk } = require('../src/conversation/callCorrectives');
const { numbersIn } = require('../src/conversation/numberWords');
const {
  coverageAskSpeech,
  foldCanonicalPlace,
  visitBlockSpeech,
  unsureCoverageSpeech,
} = require('../src/conversation/visitLocation');
const { ensureRequiredCreateRequest } = require('../src/conversation/requiredCreateRequest');
const { replayCall } = require('../src/speech/replayVoice');
const { analyzeCallerLanguage, resolveLanguageState, createLanguageState } = require('../src/conversation/language');
const { lockFileNameAsk } = require('../src/speech/callerFileSpeech');
const { drainSpokenSpeakSlots } = require('../src/conversation/speakSlots');
const {
  authorizeSpeak,
  createSpeakCommit,
  commitTurnFacts,
  commitReadySpeakSlots,
} = require('../src/speech/speakPacket');

const PRICE_SW = 'Carpet cleaning ni Ksh 1500-2000.';
const PRICE_EN = 'Carpet cleaning is Ksh 1500-2000.';

const PRICE_FILE = {
  vertical: 'home_services',
  servicesCatalog: [
    { name: 'Couch cleaning', price_range: '800-1200' },
    { name: 'Carpet cleaning', price_range: 'Ksh 1500-2000', notes: 'per room' },
    { name: 'Sofa cleaning' },
    { name: 'General cleaning' },
  ],
};

const LIST_FILE = {
  vertical: 'home_services',
  servicesCatalog: [
    { name: 'Couch cleaning' },
    { name: 'Mattress cleaning' },
    { name: 'Carpet cleaning' },
    { name: 'General cleaning' },
  ],
  callerMemory: {
    name: 'Alvin',
    fileOwnerName: 'Alvin',
    sharedLine: true,
  },
};

function unboundAlvin(state) {
  state.caller.nameConfirmed = false;
  state.caller.nameJustConfirmed = false;
  state.caller.fileNameAsked = 'Alvin';
  state.caller.fileNameAskSpoken = false;
  state.returning = {
    ...(state.returning || {}),
    name: 'Alvin',
    fileOwnerName: 'Alvin',
  };
  return state;
}

function hear(state, text, profile, language) {
  return observeCallerTurn(state, {
    text,
    detectedLanguage: language,
    resolvedLanguage: language,
    profile,
    entities: extractConversationEntities(text, { profile, state }),
  });
}

function nameAskFor(state, language) {
  const gate = planCallerModelTurn(state, {
    fileNameAskCommitted: state?.caller?.fileNameAskSpoken === true,
  });
  if (gate.runModel || !gate.line) return '';
  return lockFileNameAsk(gate.line, language);
}

function playTurn({ commit, text, state, profile, language, endAction }) {
  const localReply = resolveLocalReply({
    text,
    state,
    profile,
    language,
  });
  const mouth = planCatalogueMouth({
    localReply,
    text,
    profile,
    language,
    state,
    callerTurns: state?.conversation?.answersReceived,
    catalogueListed: state?.conversation?.catalogueListed === true,
    reasoningDown: false,
    geminiCatalogue: false,
  });
  const nameJustConfirmed = state?.caller?.nameJustConfirmed === true;
  const nameAsk = nameJustConfirmed ? '' : nameAskFor(state, language);
  commitTurnFacts(commit, {
    localReply,
    catalogueLine: mouth.speakLocal ? mouth.line : '',
    catalogueListed: state?.conversation?.catalogueListed === true,
  });
  if (nameAsk || nameJustConfirmed || String(endAction || '').toUpperCase() === 'END') {
    commitReadySpeakSlots(commit, state, {
      nameJustConfirmed: nameJustConfirmed || String(endAction || '').toUpperCase() === 'END',
      catalogueListed: state?.conversation?.catalogueListed === true,
    });
  }
  const planned = commit.planCommittedSpeech({
    endAction,
    nameAsk,
    nameJustConfirmed,
    state,
  });
  drainSpokenSpeakSlots(state, planned.lines);
  if (
    mouth.speakLocal &&
    mouth.line &&
    planned.lines.includes(mouth.line) &&
    state.conversation
  ) {
    state.conversation.catalogueListed = true;
  }
  if (nameAsk && planned.lines.includes(nameAsk)) {
    state.caller.fileNameAskSpoken = true;
  }
  return { localReply, mouth, planned, nameAsk };
}

describe('SpeakPacket tiers', () => {
  it('authorizes public facts once and leaves private text uncommitted', () => {
    assert.equal(authorizeSpeak({ outcome: 'price', line: PRICE_SW }).tier, 'public');
    assert.equal(authorizeSpeak({ outcome: 'catalogue', line: 'We offer Carpet cleaning.' }).tier, 'public');
    assert.equal(authorizeSpeak({ outcome: 'hours', line: 'We are open until 6.' }).tier, 'public');
    assert.equal(authorizeSpeak({ outcome: 'hours_ask', line: 'We open at 8.' }).tier, 'public');
    assert.equal(authorizeSpeak({ outcome: 'coverage', line: 'We cover Westlands.' }).tier, 'public');
    assert.equal(
      authorizeSpeak({ outcome: 'service_facts', line: PRICE_EN }).tier,
      'public'
    );
    assert.equal(authorizeSpeak({ outcome: 'identity', line: 'I am the assistant.' }).tier, 'step_up');
    assert.equal(authorizeSpeak({ outcome: 'visit_time', line: 'What time works?' }), null);
    assert.equal(
      authorizeSpeak({
        outcome: 'service_facts',
        line: "I don't have more detail on file.",
      }),
      null
    );
    assert.equal(
      authorizeSpeak({
        outcome: 'catalogue',
        line: 'You have two open carpet cleaning requests.',
      }),
      null
    );
    assert.equal(
      authorizeSpeak({
        outcome: 'price',
        line: 'You have two open carpet cleaning requests.',
      }),
      null
    );
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'speech', 'speakPacket.js'), 'utf8');
    assert.doesNotMatch(source, /PUBLIC_ANSWER/);
  });

  it('speaks a committed public price before the name, and identity trails', () => {
    const state = unboundAlvin(createBrainState(PRICE_FILE));
    const commit = createSpeakCommit();
    commit.commit(authorizeSpeak({ outcome: 'price', line: PRICE_SW }));
    commit.commit(authorizeSpeak({ outcome: 'identity', line: 'I am the assistant.' }));
    const lines = commit.drain({
      nameAsk: 'Je, naongea na Alvin?',
      state,
    });
    assert.deepEqual(lines, [PRICE_SW, 'I am the assistant.', 'Je, naongea na Alvin?']);
    assert.equal(lines.join(' ').includes('CATALOGUE MOUTH'), false);
  });

  it('keeps a committed public price when the file gate would drop the name in it', () => {
    const state = unboundAlvin(createBrainState(PRICE_FILE));
    const price = 'Carpet cleaning for Alvin is Ksh 1500-2000.';
    const commit = createSpeakCommit();
    commit.commit(authorizeSpeak({ outcome: 'price', line: price }));
    const lines = commit.drain({
      nameAsk: 'Je, naongea na Alvin?',
      state,
    });
    assert.equal(lines[0], price);
    assert.equal(lines[1], 'Je, naongea na Alvin?');
  });

  it('flushes an unsaid public packet on name yes and does not ask the name again', () => {
    const commit = createSpeakCommit();
    commit.commit(authorizeSpeak({ outcome: 'price', line: PRICE_SW }));
    const planned = commit.planCommittedSpeech({
      endAction: 'ANSWER',
      nameAsk: 'Je, naongea na Alvin?',
      nameJustConfirmed: true,
      state: {
        caller: { nameConfirmed: true, nameJustConfirmed: true, fileNameAsked: 'Alvin' },
      },
    });
    assert.equal(planned.farewell, false);
    assert.deepEqual(planned.lines, [PRICE_SW]);
  });

  it('speaks a Brain speak slot before the name ask and removes it once spoken', () => {
    const state = unboundAlvin(createBrainState(PRICE_FILE));
    state.conversation.speakSlots = [{ outcome: 'price', line: PRICE_SW, language: 'sw' }];
    const commit = createSpeakCommit();
    const turn = playTurn({
      commit,
      text: 'Ni pesa ngapi?',
      state,
      profile: PRICE_FILE,
      language: 'sw',
      endAction: 'ANSWER',
    });
    assert.equal(turn.planned.lines[0], PRICE_SW);
    assert.equal(turn.planned.lines[1], 'Je, naongea na Alvin?');
    assert.equal(turn.planned.lines.join(' ').includes('CATALOGUE MOUTH'), false);
    assert.deepEqual(state.conversation.speakSlots, []);
  });

  it('leaves an unspoken price slot when only the name ask was spoken', () => {
    const state = unboundAlvin(createBrainState(PRICE_FILE));
    state.conversation.speakSlots = [
      { outcome: 'price', line: PRICE_SW, language: 'sw' },
      { outcome: 'catalogue', line: 'We offer Couch cleaning and Carpet cleaning.', language: 'en' },
    ];
    drainSpokenSpeakSlots(state, ['Je, naongea na Alvin?']);
    assert.equal(state.conversation.speakSlots.length, 2);
    const yes = createSpeakCommit();
    state.caller.nameConfirmed = true;
    state.caller.nameJustConfirmed = true;
    state.caller.fileNameAskSpoken = true;
    const flushed = playTurn({
      commit: yes,
      text: 'Eeh',
      state,
      profile: PRICE_FILE,
      language: 'sw',
      endAction: 'ANSWER',
    });
    assert.equal(flushed.planned.lines[0], PRICE_SW);
    assert.equal(flushed.planned.lines.includes('Je, naongea na Alvin?'), false);
    assert.doesNotMatch(flushed.planned.lines.join(' '), /Couch cleaning/);
    assert.equal(
      state.conversation.speakSlots.some((slot) => slot.outcome === 'price'),
      false
    );
  });

  it('does not farewell while a public packet is still unsaid', () => {
    const pending = createSpeakCommit();
    pending.commit(authorizeSpeak({ outcome: 'price', line: PRICE_SW }));
    const held = pending.planCommittedSpeech({
      endAction: 'END',
      nameAsk: 'Je, naongea na Alvin?',
      state: unboundAlvin(createBrainState(PRICE_FILE)),
    });
    assert.equal(held.farewell, false);
    assert.deepEqual(held.lines, [PRICE_SW]);

    const clear = createSpeakCommit();
    const bye = clear.planCommittedSpeech({ endAction: 'END' });
    assert.equal(bye.farewell, true);
    assert.deepEqual(bye.lines, []);
  });
});

describe('HD_ad735 price then name, then yes', () => {
  it('speaks the Kiswahili file price before Je, naongea na Alvin', () => {
    let state = createBrainState(PRICE_FILE);
    state = hear(state, 'Carpet cleaning', PRICE_FILE, 'en');
    state = hear(state, 'Ni pesa ngapi?', PRICE_FILE, 'sw');
    unboundAlvin(state);
    const decision = determineNextBestAction({ state });
    assert.notEqual(decision.action, 'END');
    state = setNextBestAction(state, decision);
    const commit = createSpeakCommit();
    const turn = playTurn({
      commit,
      text: 'Ni pesa ngapi?',
      state,
      profile: PRICE_FILE,
      language: 'sw',
      endAction: decision.action,
    });
    assert.equal(turn.localReply.outcome, 'price');
    assert.equal(turn.localReply.line, PRICE_SW);
    assert.equal(turn.planned.lines[0], PRICE_SW);
    assert.equal(turn.planned.lines[1], 'Je, naongea na Alvin?');
    assert.equal(turn.planned.lines.join(' ').includes('CATALOGUE MOUTH'), false);
    assert.equal(turn.mouth.letGemini, false);
  });

  it('name yes does not end, re-ask the name, or re-list', () => {
    let state = createBrainState(PRICE_FILE);
    state = hear(state, 'Carpet cleaning', PRICE_FILE, 'en');
    state = hear(state, 'Ni pesa ngapi?', PRICE_FILE, 'sw');
    unboundAlvin(state);
    const commit = createSpeakCommit();
    const priced = playTurn({
      commit,
      text: 'Ni pesa ngapi?',
      state,
      profile: PRICE_FILE,
      language: 'sw',
      endAction: 'ANSWER',
    });
    assert.equal(priced.planned.lines[0], PRICE_SW);
    state = observeCallerTurn(state, {
      text: 'Eeh, unaongea na Alvin?',
      detectedLanguage: 'sw',
      resolvedLanguage: 'sw',
      profile: PRICE_FILE,
      lastAgentText: 'Je, naongea na Alvin?',
    });
    const decision = determineNextBestAction({ state });
    assert.equal(decision.action, 'ANSWER');
    assert.notEqual(decision.action, 'END');
    state = setNextBestAction(state, decision);
    const yes = playTurn({
      commit,
      text: 'Eeh, unaongea na Alvin?',
      state,
      profile: PRICE_FILE,
      language: 'sw',
      endAction: decision.action,
    });
    assert.equal(yes.planned.lines.includes('Je, naongea na Alvin?'), false);
    assert.equal(yes.planned.lines.includes(PRICE_SW), false);
    assert.doesNotMatch(yes.planned.lines.join(' '), /Couch cleaning/);
    assert.equal(yes.planned.lines.join(' ').includes('CATALOGUE MOUTH'), false);
  });
});

describe('HD_993 local catalogue, detail, and price', () => {
  it('speaks the Phase-0 list first for which service is you offer', () => {
    let state = createBrainState(PRICE_FILE);
    state = hear(state, 'which service is you offer', PRICE_FILE, 'en');
    unboundAlvin(state);
    const decision = determineNextBestAction({ state });
    state = setNextBestAction(state, decision);
    const commit = createSpeakCommit();
    const turn = playTurn({
      commit,
      text: 'which service is you offer',
      state,
      profile: PRICE_FILE,
      language: 'en',
      endAction: decision.action,
    });
    assert.equal(turn.mouth.speakLocal, true);
    assert.equal(turn.mouth.letGemini, false);
    assert.match(turn.planned.lines[0], /Couch cleaning/);
    assert.match(turn.planned.lines[0], /Carpet cleaning/);
    assert.match(turn.planned.lines[0], /\band\b/);
    assert.doesNotMatch(turn.planned.lines[0], /CATALOGUE MOUTH/);
    assert.equal(turn.planned.lines.at(-1), 'Am I speaking with Alvin?');
    assert.notEqual(turn.planned.lines[0], turn.planned.lines.at(-1));
  });

  it('does not re-list on a carpet detail, and speaks the file price for how much', () => {
    let state = createBrainState(PRICE_FILE);
    state = hear(state, 'which service is you offer', PRICE_FILE, 'en');
    unboundAlvin(state);
    const commit = createSpeakCommit();
    const listed = playTurn({
      commit,
      text: 'which service is you offer',
      state,
      profile: PRICE_FILE,
      language: 'en',
      endAction: 'ANSWER',
    });
    assert.equal(state.conversation.catalogueListed, true);
    state.caller.fileNameAskSpoken = true;
    state.caller.nameConfirmed = true;
    state.caller.nameJustConfirmed = false;
    state = hear(state, 'tell me more about carpet', PRICE_FILE, 'en');
    state.caller.nameConfirmed = true;
    state.caller.fileNameAskSpoken = true;
    const detail = playTurn({
      commit,
      text: 'tell me more about carpet',
      state,
      profile: PRICE_FILE,
      language: 'en',
      endAction: 'ANSWER',
    });
    assert.notEqual(detail.localReply && detail.localReply.outcome, 'catalogue');
    assert.doesNotMatch(detail.planned.lines.join(' '), /Couch cleaning/);
    assert.doesNotMatch(detail.planned.lines.join(' '), /CATALOGUE MOUTH/);
    assert.match(detail.planned.lines.join(' '), /Carpet cleaning/);
    state = hear(state, 'How much is it?', PRICE_FILE, 'en');
    state.caller.nameConfirmed = true;
    state.caller.fileNameAskSpoken = true;
    const price = playTurn({
      commit,
      text: 'How much is it?',
      state,
      profile: PRICE_FILE,
      language: 'en',
      endAction: 'ANSWER',
    });
    assert.equal(price.localReply.outcome, 'price');
    assert.equal(price.planned.lines[0], PRICE_EN);
    assert.doesNotMatch(price.planned.lines.join(' '), /Couch cleaning/);
    assert.equal(listed.mouth.speakLocal, true);
  });
});

describe('HD_c705 and HD_708 name yes continues', () => {
  it('Eeh and Yes after the list are ANSWER, not END, and do not re-list', () => {
    for (const text of ['Eeh, unaongea na Alvin?', 'Yes.']) {
      let state = createBrainState(LIST_FILE);
      state = hear(state, 'Tell me your services, man.', LIST_FILE, 'en');
      unboundAlvin(state);
      const listed = determineNextBestAction({ state });
      assert.equal(listed.action, 'ANSWER');
      state = setNextBestAction(state, listed);
      const commit = createSpeakCommit();
      const first = playTurn({
        commit,
        text: 'Tell me your services, man.',
        state,
        profile: LIST_FILE,
        language: 'en',
        endAction: listed.action,
      });
      assert.match(first.planned.lines[0], /Couch cleaning/);
      assert.equal(first.mouth.letGemini, false);
      assert.equal(state.conversation.catalogueListed, true);
      state = observeCallerTurn(state, {
        text,
        detectedLanguage: 'sw',
        resolvedLanguage: 'sw',
        profile: LIST_FILE,
        lastAgentText: 'Je, naongea na Alvin?',
      });
      const decision = determineNextBestAction({ state });
      assert.equal(decision.action, 'ANSWER');
      assert.notEqual(decision.action, 'END');
      state = setNextBestAction(state, decision);
      const yes = playTurn({
        commit,
        text,
        state,
        profile: LIST_FILE,
        language: 'sw',
        endAction: decision.action,
      });
      assert.equal(yes.planned.farewell, false);
      assert.equal(yes.planned.lines.includes('Je, naongea na Alvin?'), false);
      assert.doesNotMatch(yes.planned.lines.join(' '), /Couch cleaning/);
      assert.doesNotMatch(yes.planned.lines.join(' '), /CATALOGUE MOUTH/);
    }
  });

  it('a detail after the public list does not speak the list again', () => {
    let state = createBrainState(LIST_FILE);
    state = hear(state, 'Tell me your services, man.', LIST_FILE, 'en');
    const listed = determineNextBestAction({ state });
    state = setNextBestAction(state, listed);
    const commit = createSpeakCommit();
    playTurn({
      commit,
      text: 'Tell me your services, man.',
      state,
      profile: LIST_FILE,
      language: 'en',
      endAction: 'ANSWER',
    });
    state.caller.nameConfirmed = true;
    state.caller.fileNameAskSpoken = true;
    state = hear(state, 'tell me more about carpet', LIST_FILE, 'en');
    state.caller.nameConfirmed = true;
    const detail = playTurn({
      commit,
      text: 'tell me more about carpet',
      state,
      profile: LIST_FILE,
      language: 'en',
      endAction: 'ANSWER',
    });
    assert.doesNotMatch(detail.planned.lines.join(' '), /Mattress cleaning/);
    assert.doesNotMatch(detail.planned.lines.join(' '), /CATALOGUE MOUTH/);
  });
});

describe('HD_0789461c5319 catalogue, callback, and Kiswahili', () => {
  const ASK = 'Ah, mimi nilikuwa nauliza what you guys offer';

  it('speaks the catalogue with the name ask on the mixed offer turn', () => {
    const evidence = analyzeCallerLanguage(ASK);
    const sticky = resolveLanguageState(createLanguageState(), evidence);
    assert.equal(sticky.current, 'sw');
    let state = createBrainState(LIST_FILE);
    state = hear(state, ASK, LIST_FILE, sticky.current);
    unboundAlvin(state);
    const decision = determineNextBestAction({ state });
    assert.notEqual(decision.action, 'END');
    state = setNextBestAction(state, decision);
    const turn = playTurn({
      commit: createSpeakCommit(),
      text: ASK,
      state,
      profile: LIST_FILE,
      language: sticky.current,
      endAction: decision.action,
    });
    assert.equal(turn.mouth.speakLocal, true);
    assert.equal(turn.mouth.letGemini, false);
    const spoken = turn.planned.lines.join(' ');
    assert.match(spoken, /Couch cleaning/);
    assert.match(spoken, /Mattress cleaning/);
    assert.match(spoken, /Carpet cleaning/);
    assert.match(spoken, /General cleaning/);
    assert.match(spoken, /Am I speaking with Alvin\?|Je, naongea na Alvin\?/);
    assert.notEqual(turn.planned.lines[0], turn.planned.lines.at(-1));
    assert.doesNotMatch(spoken, /CATALOGUE MOUTH/);
    assert.equal(state.conversation.catalogueListed, true);
  });

  it('does not ask which service twice after the list', () => {
    let state = createBrainState(LIST_FILE);
    state = hear(state, ASK, LIST_FILE, 'sw');
    unboundAlvin(state);
    const commit = createSpeakCommit();
    playTurn({
      commit,
      text: ASK,
      state,
      profile: LIST_FILE,
      language: 'sw',
      endAction: 'ANSWER',
    });
    state = observeCallerTurn(state, {
      text: 'Yes.',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile: LIST_FILE,
      lastAgentText: 'Je, naongea na Alvin?',
    });
    const yes = playTurn({
      commit,
      text: 'Yes.',
      state,
      profile: LIST_FILE,
      language: 'en',
      endAction: 'ANSWER',
    });
    assert.equal(yes.planned.farewell, false);
    assert.doesNotMatch(yes.planned.lines.join(' '), /Couch cleaning/);
    const polished = polishSpokenReply(
      'We offer couch cleaning, carpet cleaning, mattress cleaning, and general cleaning. Which service would you like to book, Alvin?',
      {
        state,
        profile: LIST_FILE,
        callerTurns: ['Yes.'],
        language: 'en',
      }
    );
    const questions = polished
      .split(/(?<=[.?!])\s+/)
      .filter((part) => /which service|which one|unahitaji/i.test(part));
    assert.ok(questions.length <= 1, polished);
    assert.doesNotMatch(polished, /Which service do you need\?.*Which service would you like/s);
  });

  it('keeps the callback offer, and Sawa resolves it into a farewell', flagOff(() => {
    const offered = guardSpokenReply(
      'Kilicho iko outside our standard Nairobi coverage area, so we cannot book a direct visit right now. Would you like me to log a callback for the team to check if we can reach you?',
      {
        callerTurns: ['Eeh, mimi naishi Kilicho though.'],
        profile: { coverage: 'Nairobi' },
        state: {
          caller: { nameConfirmed: true, name: 'Alvin' },
          conversation: { answersReceived: ['Eeh, mimi naishi Kilicho though.'] },
        },
        language: 'en',
        allowEmpty: true,
      }
    );
    assert.match(offered, /cannot book a direct visit/);
    assert.match(offered, /Would you like me to log a callback/);
    assert.match(offered, /Kilicho/);
    assert.doesNotMatch(offered, /Kilimani/);
    let state = createBrainState(LIST_FILE);
    noteSpokenPendingAsk(state, 'Would you like me to log a callback?');
    for (const text of ['Sawa.', 'Yes.', 'ok', 'ndio']) {
      const next = observeCallerTurn(state, {
        text,
        detectedLanguage: 'sw',
        resolvedLanguage: 'sw',
        profile: LIST_FILE,
      });
      assert.equal(next.conversation.consentAck, true, text);
      assert.equal(next.conversation.nonConsentAck, false, text);
    }
    const planned = planEmptyGeminiSpeech({
      language: 'sw',
      userText: 'Sawa.',
      toolResults: [{ action: 'create_service_request', status: 'succeeded' }],
    });
    assert.notEqual(planned.kind, 'hear_again');
    assert.match(planned.line, /nimehifadhi|saved/i);
    assert.match(planned.line, /Asante\. Kwaheri\./);
    const repair = planEmptyGeminiSpeech({ language: 'en', userText: 'Sawa.' });
    assert.equal(repair.kind, 'hear_again');
  }));

  it('reads Kiswahili from keywords when Soniox tags are empty, and from tags when they exist', () => {
    const bnb = analyzeCallerLanguage('Wewe unafanya vitu za BNB?');
    assert.equal(bnb.language, 'sw');
    assert.ok(bnb.confidence >= 0.82);
    const fromEn = resolveLanguageState(
      { ...createLanguageState(), current: 'en', confidence: 0.9 },
      bnb
    );
    assert.equal(fromEn.current, 'sw');
    const home = analyzeCallerLanguage('Eeh, mimi naishi Kilicho though.');
    assert.equal(home.language, 'sw');
    assert.notEqual(home.language, 'unknown');
    const bare = analyzeCallerLanguage('Wewe unafanya vitu za BNB?', { tokenLanguages: [] });
    assert.equal(bare.language, 'sw');
    const tagged = analyzeCallerLanguage('offer please', { tokenLanguages: ['sw', 'sw', 'sw'] });
    assert.equal(tagged.language, 'sw');
  });
});

describe('HD_e3fb94e1bd0d prices, offer consent, and Nakuru', () => {
  const DUSTED = ownerCoverage({
    vertical: 'home_services',
    businessName: 'Done and Dusted',
    servicesCatalog: [
      { name: 'Couch cleaning', price_range: 'Ksh 800-1200' },
      { name: 'Mattress cleaning', price_range: 'Ksh 800-1200' },
      { name: 'Carpet cleaning', price_range: 'Ksh 1500-2000' },
      { name: 'General cleaning' },
    ],
    businessPolicies: {
      coverage_areas: [
        'county:nairobi',
        'county:kiambu',
        'place:kitengela',
        'place:juja',
        'place:ongata rongai',
        'place:syokimau',
      ],
    },
    socialHandles: '0790381872',
  });

  it('reads a hyphen, dash, or to/hadi/mpaka span as the file numbers', () => {
    for (const text of [
      'Ksh 1500-2000',
      'Ksh 1500–2000',
      '1500 to 2000',
      '1500 hadi 2000',
      '1500 mpaka 2000',
      'Ksh 800-1200',
    ]) {
      const found = numbersIn(text);
      assert.ok(found.has(text.includes('800') ? '800' : '1500'), text);
      assert.ok(found.has(text.includes('1200') ? '1200' : '2000'), text);
    }
    const phone = numbersIn('0712-345678');
    assert.equal(phone.has('712'), false);
    assert.equal(phone.has('345678'), false);
  });

  it('keeps an English and a Kiswahili price that the file wrote with a hyphen', () => {
    const en = guardSpokenReply(
      'For carpet cleaning, it is Ksh 1500 to 2000 depending on the size.',
      {
        callerTurns: ['For carpet cleaning?'],
        profile: DUSTED,
        language: 'en',
        allowEmpty: true,
        state: { conversation: { answersReceived: ['For carpet cleaning?'] } },
      }
    );
    assert.match(en, /1500/);
    assert.match(en, /2000/);
    const sw = guardSpokenReply('Mattress cleaning ni 800 hadi 1200.', {
      callerTurns: ['Mattress?' ],
      profile: DUSTED,
      language: 'sw',
      allowEmpty: true,
      state: { conversation: { answersReceived: ['Mattress?'] } },
    });
    assert.match(sw, /800/);
    assert.match(sw, /1200/);
    const dropped = polishSpokenDetail('It is Ksh 1500 to 2000.', {
      callerTurns: ['how much'],
      profile: { businessName: 'Done and Dusted', servicesCatalog: [] },
      language: 'en',
      state: { conversation: { answersReceived: ['how much'] } },
    });
    assert.doesNotMatch(dropped.text, /1500|2000/);
    assert.equal(dropped.reason, 'unsaid_number');
  });

  it('binds na kuru to Nakuru and does not say the coverage list is missing', () => {
    assert.match(foldCanonicalPlace('na kuru', DUSTED), /Nakuru/);
    const sw = coverageAskSpeech('Like, mnafika na kuru?', DUSTED, 'sw');
    assert.match(sw, /nje/);
    assert.match(sw, /Naweza kukuachia ujumbe kwa timu yetu\?/);
    assert.doesNotMatch(sw, /orodha|don't have our coverage list/i);
    const en = coverageAskSpeech('Like, do you cover na kuru?', DUSTED, 'en');
    assert.match(en, /outside our coverage/);
    assert.match(en, /Should I note it for the team\?/);
    assert.doesNotMatch(en, /don't have our coverage list/i);
    assert.equal(visitBlockSpeech('outside', 'en'), 'That area is outside our coverage.');
    const unsure = unsureCoverageSpeech('en');
    assert.match(unsure, /not sure we cover that area/);
    assert.match(unsure, /Should I note it for the team\?/);
    assert.doesNotMatch(unsure, /don't have our coverage list/i);
    const shops = coverageAskSpeech('Do you cover the shops?', DUSTED, 'en');
    // BRAIN_CALL_FIXES_D199 (c): not a real place, so no coverage packet at all.
    if (process.env.BRAIN_CALL_FIXES_D199 === 'on') assert.equal(shops, '');
    else assert.match(shops, /not sure we cover that area/);
    assert.doesNotMatch(shops, /don't have our coverage list/i);
    const spoken = guardSpokenReply(
      'Nakuru iko nje ya area yetu ya huduma kwani tunafanya Nairobi na maeneo ya karibu pekee.',
      {
        callerTurns: ['Like, mnafika na kuru?'],
        profile: DUSTED,
        language: 'sw',
        allowEmpty: true,
        state: { conversation: { answersReceived: ['Like, mnafika na kuru?'] } },
      }
    );
    assert.match(spoken, /Nakuru/);
    assert.match(spoken, /Nairobi/);
  });

  it('arms a spoken offer in Kiswahili or as an English statement, then saves on yes', flagOff(() => {
    for (const line of [
      'Naweza kukuachia ujumbe kwa timu yetu?',
      'I can note this for the team.',
      'Would you like me to log a callback?',
      'Should I note it for the team?',
      'Naweza andika hii kwa team?',
    ]) {
      const state = { conversation: { questionsAsked: [] } };
      noteSpokenPendingAsk(state, line);
      assert.equal(state.conversation.questionsAsked.at(-1), 'offer', line);
      assert.equal(state.conversation.pendingAsk.kind, 'offer', line);
      assert.equal(state.conversation.pendingAsk.act, 'note_team', line);
    }
    for (const line of [
      'When would you like us to come?',
      'Would you like to book a visit?',
      'Which service do you need?',
      'Tuje lini kukufanyia cleaning?',
      'Am I speaking with Alvin?',
    ]) {
      const state = { conversation: { questionsAsked: [] } };
      noteSpokenPendingAsk(state, line);
      assert.notEqual(state.conversation.questionsAsked.at(-1), 'offer', line);
      assert.equal(state.conversation.pendingAsk || null, null, line);
    }
    const pending = {
      kind: 'offer',
      act: 'note_team',
      line: 'Naweza kukuachia ujumbe kwa timu yetu?',
    };
    for (const text of ['sawa', 'ok', 'okay', 'yes', 'ndio', 'sure']) {
      assert.equal(
        shouldSkipCallerTurn(text, {
          lastAgentText: 'Carpet cleaning is Ksh 1500 to 2000.',
          pendingAsk: pending,
          questionsAsked: ['offer'],
        }),
        false,
        text
      );
    }
    assert.equal(
      shouldSkipCallerTurn('sawa', { lastAgentText: 'Carpet cleaning is Ksh 1500 to 2000.' }),
      true
    );
    let state = createBrainState(DUSTED);
    noteSpokenPendingAsk(state, 'I can note this for the team.');
    for (const text of ['Sawa.', 'Okay.', 'yes', 'ndio', 'sure']) {
      const next = observeCallerTurn(state, {
        text,
        detectedLanguage: 'en',
        resolvedLanguage: 'en',
        profile: DUSTED,
      });
      assert.equal(next.conversation.consentAck, true, text);
    }
    const saved = ensureRequiredCreateRequest(
      {},
      {
        caller: { name: 'Alvin', phone: '+254790381872' },
        conversation: {
          consentAck: true,
          pendingAsk: pending,
          questionsAsked: ['offer'],
          answersReceived: ['Mnafika Nakuru?', 'Sawa.'],
        },
      },
      {}
    );
    assert.equal(saved.serviceRequest.type, 'callback');
    assert.equal(saved.serviceRequest.item, 'message');
    assert.equal(saved.serviceRequest.name, 'Alvin');
    // The note is the caller's ask, never the agent's offer line (HD_23445a4f780c).
    assert.match(saved.serviceRequest.notes, /Nakuru/);
    assert.doesNotMatch(saved.serviceRequest.notes, /kukuachia ujumbe/);
    const named = ensureRequiredCreateRequest(
      {},
      {
        caller: { name: 'Alvin' },
        conversation: { consentAck: false, questionsAsked: ['name'] },
      },
      {}
    );
    assert.equal(named.serviceRequest, undefined);
    const planned = planEmptyGeminiSpeech({
      language: 'sw',
      userText: 'Sawa.',
      toolResults: [{ action: 'create_service_request', status: 'succeeded' }],
    });
    assert.match(planned.line, /nimehifadhi|saved/i);
    assert.match(planned.line, /Asante\. Kwaheri\./);
    const kept = guardSpokenReply('I can note this for the team.', {
      callerTurns: ['Like, do you cover na kuru?'],
      profile: DUSTED,
      language: 'en',
      allowEmpty: true,
    });
    assert.match(kept, /note this for the team/i);
  }));
});

describe('HD_0789 and HD_486 coverage lines stay in the replay', () => {
  const COVERAGE = ownerCoverage({
    businessName: 'Done and Dusted',
    businessPolicies: {
      coverage_areas: [
        'county:nairobi',
        'county:kiambu',
        'place:kitengela',
        'place:juja',
        'place:ongata rongai',
        'place:syokimau',
      ],
    },
  });

  function ttsText(turn) {
    const row = (turn.stages || []).find((stage) => stage.stage === 'tts');
    return String(row?.text || '');
  }

  it('keeps the Kilicho line and the callback question', async () => {
    const line =
      'Kilicho iko outside our standard Nairobi coverage area, so we cannot book a direct visit right now. Would you like me to log a callback for the team to check if we can reach you?';
    const replay = await replayCall({
      callId: 'HD_0789461c5319',
      ...COVERAGE,
      callerName: 'Alvin',
      nameOnFile: true,
      turns: [
        {
          caller: 'Eeh, mimi naishi Kilicho though.',
          flushed: true,
          model: {
            provider: 'gemini',
            model: 'recorded',
            promptId: 'voice.system',
            outputText: line,
          },
        },
      ],
    });
    const spoken = ttsText(replay.turns[0]);
    assert.match(spoken, /Kilicho iko outside/);
    assert.match(spoken, /Nairobi/);
    assert.match(spoken, /log a callback/);
    assert.doesNotMatch(spoken, /Kilimani/);
    assert.equal(
      replay.turns[0].stages.some((row) => row.reason === 'unbound_place'),
      false
    );
  });

  it('keeps both HD_486 coverage lines, and an out-of-area answer keeps the question', async () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'fixtures/voice-calls/HD_48631816b68c.json'),
        'utf8'
      )
    );
    fixture.businessPolicies = COVERAGE.businessPolicies;
    fixture.fieldMeta = COVERAGE.fieldMeta;
    const replay = await replayCall(fixture);
    const turn4 = ttsText(replay.turns[3]);
    const turn5 = ttsText(replay.turns[4]);
    const turn7 = ttsText(replay.turns[6]);
    assert.match(turn4, /Nairobi/);
    // Place names reach Soniox as written (2026-10-08 town A/B on #612).
    assert.match(turn4, /Kitengela/);
    assert.match(turn4, /Kiambu/);
    assert.match(turn4, /Juja/);
    assert.match(turn4, /Ongata Rongai/);
    assert.match(turn4, /Syokimau/);
    assert.doesNotMatch(turn4, /Kee-ten-geh-la|Kee-ahm-boo|Joo-jah|Shyo-kee-mau/);
    assert.match(turn4, /tukutembelee wapi/);
    assert.match(turn5, /ndani ya Nairobi/);
    assert.match(turn5, /OngataRongai/);
    assert.match(turn5, /kwako/);
    assert.match(turn5, /Upo eneo gani/);
    assert.doesNotMatch(`${turn4} ${turn5}`, /Ndanai|\bKako\b/);
    assert.match(turn7, /Nakuru/);
    assert.match(turn7, /note kwa timu/);
    for (const index of [3, 4]) {
      assert.equal(
        replay.turns[index].stages.some((row) => row.reason === 'unbound_place'),
        false,
        `turn ${index + 1}`
      );
    }
    const outside = guardSpokenReply(
      'Pole sana Alvin, eneo la Nakuru liko nje ya huduma zetu kwa sasa. Ungependa nikuwekee note kwa timu yetu?',
      {
        callerTurns: ['Mtafika kwangu kweli?'],
        profile: COVERAGE,
        language: 'sw',
        allowEmpty: true,
      }
    );
    assert.match(outside, /note kwa timu/);
    assert.doesNotMatch(outside, /Nakuru/);
  });
});
