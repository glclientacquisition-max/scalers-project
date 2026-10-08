// One caller turn, one contract. server.js and the offline simulator run the
// same chain, so a playbook cannot bypass a gate. Order matters:
// identity → coverage ask → place block → hours refusal → corrective → visit time ask → phatic.
// Anything that falls through goes to Gemini behind the speech and tool guards.
// See docs/agents/BRAIN_TURN_CONTRACT.md.

const {
  looksLikeBareCloser,
  looksLikeIdentityQuestion,
  looksLikePaceOnlyTurn,
  looksLikePhaticCallerTurn,
  looksLikeRobotQuestion,
  pickIdentityReply,
} = require('./dynamicSpeech');
const { coverageAskSpeech, visitBlockSpeech } = require('./visitLocation');
const { formatVisitTimeProblem } = require('./toolExecution');
const {
  looksLikeLeaveIt,
  looksLikeNameIntroductionOnly,
  looksLikeNonConsentAck,
  looksLikeUrgentContact,
  looksLikeVagueSmallTalk,
  pickCorrectiveReply,
} = require('./callCorrectives');
const { timeAskCount, timeAskLine, whenValue } = require('./visitTime');
const { hoursAskLine, offerCatalogueLine } = require('./knownFacts');
const {
  catalogueItemNames,
  fileServicePriceLine,
  freshCatalogueAsk,
  geminiCatalogueEnabled,
  serviceFactsLine,
} = require('./catalogueMouth');
const { catalogueAskInPlay } = require('./fileRead');
const { callerTurnKinds, messageOnlyCallbackLine } = require('./messageOnly');
const { fillSpeakSlot, takePendingSpeakSlot } = require('./speakSlots');
const { unfinishedTurnHold } = require('./unfinishedTurn');

const AFFIRMATIVE_OPENER = /^(yes|yeah|yep|okay|ok|sawa|ndio|poa)\b/i;

function nothingSavedLine(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw') return 'Sawa. Sijahifadhi chochote.';
  if (lang === 'sheng') return 'Poa. Sijasave chochote.';
  return 'Okay. Nothing saved.';
}

/**
 * Coarse turn kind for logs, the contract doc, and the simulator.
 * Not a replacement for intent. A turn can be a statement and carry slots.
 */
function classifyCallerTurn(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'empty';
  if (looksLikePaceOnlyTurn(raw)) return 'pace';
  if (looksLikeRobotQuestion(raw) || looksLikeIdentityQuestion(raw)) return 'identity';
  if (looksLikeLeaveIt(raw)) return 'leave_it';
  if (looksLikeUrgentContact(raw)) return 'urgent';
  if (looksLikeBareCloser(raw)) return 'closer';
  if (looksLikeNonConsentAck(raw)) return 'ack';
  if (looksLikeNameIntroductionOnly(raw)) return 'name_only';
  if (looksLikeVagueSmallTalk(raw)) return 'vague';
  if (looksLikePhaticCallerTurn(raw)) return 'phatic';
  if (/\?\s*$/.test(raw) || /^(what|when|where|which|how|do you|can you|are you|is it|je\b)/i.test(raw)) {
    return 'question';
  }
  return 'statement';
}

/**
 * Deterministic reply before Gemini. Returns null when Gemini should run.
 * @returns {{ outcome: string, line: string } | null}
 */
function fileNameAskLine(state) {
  if (state?.caller?.nameConfirmed === true) return '';
  if (state?.caller?.fileNameAskSpoken === true) return '';
  const pending = String(state?.caller?.fileNameAsked || '').trim();
  if (!pending) return '';
  return `Am I speaking with ${pending}?`;
}

/**
 * One gate in front of every model turn, including a greeting barge.
 * A cancelled greeting did not deliver the ask. Until this process commits
 * the line, the only reply is "Am I speaking with {name}?" and the model
 * does not run. A heard greeting or a committed ask is not asked again.
 */
function planCallerModelTurn(state, opts = {}) {
  const caller = state?.caller;
  if (
    caller &&
    opts.greetingBarged === true &&
    opts.fileNameAskCommitted !== true &&
    caller.nameConfirmed !== true
  ) {
    caller.fileNameAskSpoken = false;
  }
  if (
    caller &&
    caller.nameConfirmed !== true &&
    caller.fileNameAskSpoken !== true &&
    !String(caller.fileNameAsked || '').trim() &&
    state?.returning &&
    !state.returning.sharedLine &&
    !state.returning.identityBound
  ) {
    const who = String(state.returning.fileOwnerName || state.returning.name || '').trim();
    if (who) caller.fileNameAsked = who;
  }
  const line = fileNameAskLine(state);
  const latest = String((state?.conversation?.answersReceived || []).slice(-1)[0] || '');
  // An unfinished turn does not start a reply. Voice holds it on a timer and
  // passes holdTimedOut when the caller stayed quiet, so it is not held twice.
  if (
    unfinishedTurnHold(state, {
      text: latest,
      profile: opts.profile,
      agentAwaitingReply: opts.agentAwaitingReply,
      holdTimedOut: opts.holdTimedOut,
    })
  ) {
    return { runModel: false, line: '', hold: 'unfinished' };
  }
  // Staging listen: Gemini speaks the catalogue even when a file name is pending.
  // The name ask stays for the next turn. Flag off keeps the name-ask early return.
  if (line && geminiCatalogueEnabled() && freshCatalogueAsk(latest)) {
    return { runModel: true, line: '' };
  }
  if (line) return { runModel: false, line };
  return { runModel: true, line: '' };
}

function resolveLocalReply({
  text,
  state,
  profile = {},
  language = 'en',
  agentName = '',
  businessName = '',
  nextBestAction = null,
} = {}) {
  const clean = String(text || '').trim();
  if (!clean) return null;

  // Hold a public fact while the file-name ask is still due. Voice drains
  // the slot if it speaks the line. Name Yes reads whatever is still here.
  const publish = (reply) => {
    if (!reply) return null;
    if (fileNameAskLine(state)) fillSpeakSlot(state, reply, language);
    else if (state?.caller?.nameJustConfirmed && state.conversation) {
      state.conversation.speakSlots = [];
    }
    return reply;
  };

  if (looksLikeRobotQuestion(clean) || looksLikeIdentityQuestion(clean)) {
    return {
      outcome: 'identity',
      line: pickIdentityReply({
        agentName,
        businessName,
        discloseAi: looksLikeRobotQuestion(clean),
      }),
    };
  }

  // Visit, hold, and order words are on conversation.fileReadSentence for Voice.
  // Do not speak them here. A local reply would end the turn before Gemini.

  const detailLine = serviceFactsLine(clean, profile, language);
  if (detailLine) return publish({ outcome: 'service_facts', line: detailLine });

  const priceLine = fileServicePriceLine(clean, profile, language, state);
  if (priceLine) return publish({ outcome: 'price', line: priceLine });

  // A name yes does not drop the fact the name gate has not spoken yet.
  // A price or other fact wins over reading the catalogue again.
  if (state?.caller?.nameJustConfirmed) {
    const held = takePendingSpeakSlot(state);
    if (held) return { outcome: held.outcome, line: held.line };
  }

  // The list was asked and never marked answered. Hand that one list to the local mouth.
  // A yes after the list was already answered does not read it again.
  const pendingList = catalogueAskInPlay(clean, state);
  if (
    state?.caller?.nameJustConfirmed &&
    pendingList &&
    state?.conversation?.catalogueAnswered !== true
  ) {
    const held = offerCatalogueLine(pendingList, profile, language);
    if (held && !/what you need done|unahitaji nini/i.test(held)) {
      return { outcome: 'catalogue', line: held };
    }
  }

  // A name yes is not another catalogue. A detail ask is not the name list.
  // Gemini mouth (staging flag) leaves the first list to the model.
  if (
    freshCatalogueAsk(clean) &&
    !state?.caller?.nameJustConfirmed &&
    !(geminiCatalogueEnabled() && catalogueItemNames(profile).length)
  ) {
    const offerLine = offerCatalogueLine(clean, profile, language);
    if (offerLine) return publish({ outcome: 'catalogue', line: offerLine });
  }

  const coverageLine = coverageAskSpeech(clean, profile, language, state);
  if (coverageLine) return publish({ outcome: 'coverage', line: coverageLine });

  const placeBlockLine = visitBlockSpeech(state?.visitPlace?.blocked, language);
  if (placeBlockLine && looksLikeLeaveIt(clean)) {
    return { outcome: 'leave_it', line: nothingSavedLine(language) };
  }
  if (placeBlockLine && !AFFIRMATIVE_OPENER.test(clean)) {
    return { outcome: 'visit_block', line: placeBlockLine };
  }

  if (state?.conversation?.clockRefusedThisTurn) {
    return publish({
      outcome: 'hours',
      line: formatVisitTimeProblem(
        'outside_hours',
        state.conversation.hoursBlock || {},
        language
      ),
    });
  }

  // Leave-it and urgent outrank the time ladder. Everything else on a time ask
  // gets the ladder line, so "Okay" never resets to "How can I help?".
  const decision = nextBestAction || {};
  const action = String(decision.action || state?.resolution?.nextBestAction || '');
  const slot = String(decision.slot || state?.resolution?.targetSlot || '');
  const timeAsk = action === 'ASK_CLARIFICATION' && slot === 'time';
  if (
    state?.messageOnly &&
    timeAsk &&
    !looksLikeLeaveIt(clean) &&
    !looksLikeUrgentContact(clean) &&
    !callerTurnKinds(clean).knowledge
  ) {
    return { outcome: 'message_only', line: messageOnlyCallbackLine(language) };
  }
  if (timeAsk && !state?.messageOnly && !looksLikeLeaveIt(clean) && !looksLikeUrgentContact(clean)) {
    return {
      outcome: 'visit_time',
      line: timeAskLine({
        when: whenValue(state),
        pendingHour: state?.conversation?.pendingHour ?? null,
        language,
        askCount: Math.max(1, timeAskCount(state)),
      }),
    };
  }

  const hoursLine = hoursAskLine(clean, profile, language);
  if (hoursLine) return publish({ outcome: 'hours_ask', line: hoursLine });

  const correctiveLine = pickCorrectiveReply({ text: clean, state, language });
  if (correctiveLine) return { outcome: 'corrective', line: correctiveLine };

  // How-are-you, Okay, and a bare name go to Gemini. Identity, hours,
  // coverage, leave-it, and the visit-time ladder stay fixed lines.
  // The catalogue list is a fixed line unless BRAIN_GEMINI_CATALOGUE is on.
  return null;
}

module.exports = {
  classifyCallerTurn,
  fileNameAskLine,
  planCallerModelTurn,
  resolveLocalReply,
};
