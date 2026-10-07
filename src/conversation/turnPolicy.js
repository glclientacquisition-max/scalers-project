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
const { catalogueAskInPlay } = require('./fileRead');
const { callerTurnKinds, messageOnlyCallbackLine } = require('./messageOnly');

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

  const offerSource = catalogueAskInPlay(clean, state);
  const offerLine = offerSource
    ? offerCatalogueLine(offerSource, profile, language)
    : '';
  if (offerLine) return { outcome: 'catalogue', line: offerLine };

  const coverageLine = coverageAskSpeech(clean, profile, language);
  if (coverageLine) return { outcome: 'coverage', line: coverageLine };

  const placeBlockLine = visitBlockSpeech(state?.visitPlace?.blocked, language);
  if (placeBlockLine && looksLikeLeaveIt(clean)) {
    return { outcome: 'leave_it', line: nothingSavedLine(language) };
  }
  if (placeBlockLine && !AFFIRMATIVE_OPENER.test(clean)) {
    return { outcome: 'visit_block', line: placeBlockLine };
  }

  if (state?.conversation?.clockRefusedThisTurn) {
    return {
      outcome: 'hours',
      line: formatVisitTimeProblem(
        'outside_hours',
        state.conversation.hoursBlock || {},
        language
      ),
    };
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
  if (hoursLine) return { outcome: 'hours_ask', line: hoursLine };

  const correctiveLine = pickCorrectiveReply({ text: clean, state, language });
  if (correctiveLine) return { outcome: 'corrective', line: correctiveLine };

  // How-are-you, Okay, and a bare name go to Gemini. Identity, hours,
  // the catalogue, coverage, leave-it, and the visit-time ladder stay fixed lines.
  return null;
}

module.exports = {
  classifyCallerTurn,
  fileNameAskLine,
  planCallerModelTurn,
  resolveLocalReply,
};
