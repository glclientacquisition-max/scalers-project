/**
 * First-forward hangup buckets. Do not treat raw hangup as the assistant failed.
 *
 * flash: duration < 3s and no STT (often Kenya airtime protocol).
 * heard_greeting_drop: greeting PCM played, silent drop under 15s.
 * barged_job: barge-in with a job noun.
 * first_turn_goal: caller turn 1 has a goal (not empty / only hello / hangup).
 *
 * Judge the assistant on barged_job and first_turn_goal only.
 */

const { looksLikePhaticCallerTurn } = require('./dynamicSpeech');
const { isBackchannelOrFragment } = require('./entityExtraction');

const FLASH_SECONDS = 3;
const GREETING_DROP_SECONDS = 15;

const JOB_NOUN =
  /\b(carpet|couch|sofa|mattress|airbnb|upholstery|fumigation|plumbing|plumber|electric|electrician|cleaning|clean|book|booking|hold|order|price|bei|appointment|visit|delivery|till|paybill|quote|quotation|repair|leak|stain)\b/i;

const HANGUP_ONLY =
  /^(bye|goodbye|hang ?up|click|kwaheri|tutaonana|that's all|thats all|no thanks|no thank you)$/i;

const FIRST_FORWARD_BUCKETS = Object.freeze([
  'flash',
  'heard_greeting_drop',
  'barged_job',
  'first_turn_goal',
]);

const JUDGED_BUCKETS = Object.freeze(['barged_job', 'first_turn_goal']);

function cleanTurn(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeJobNoun(text) {
  return JOB_NOUN.test(cleanTurn(text));
}

function looksLikeHangupOnly(text) {
  const t = cleanTurn(text)
    .toLowerCase()
    .replace(/[?'"!.]+$/g, '')
    .trim();
  return Boolean(t) && HANGUP_ONLY.test(t);
}

function firstTurnHasGoal(text) {
  const t = cleanTurn(text);
  if (!t) return false;
  if (looksLikeHangupOnly(t)) return false;
  if (looksLikePhaticCallerTurn(t)) return false;
  if (isBackchannelOrFragment(t)) return false;
  return true;
}

/**
 * @param {{
 *   durationSeconds?: number|null,
 *   greetingPlayed?: boolean,
 *   hasStt?: boolean,
 *   bargedJob?: boolean,
 *   bargeText?: string|null,
 *   firstCallerTurn?: string|null,
 *   connectToGreetingPcmMs?: number|null,
 * }} input
 */
function classifyFirstForwardAcceptance(input = {}) {
  const durationSeconds =
    input.durationSeconds == null || !Number.isFinite(Number(input.durationSeconds))
      ? null
      : Math.max(0, Number(input.durationSeconds));
  const greetingPlayed = Boolean(input.greetingPlayed);
  const hasStt = Boolean(input.hasStt);
  const firstCallerTurn = cleanTurn(input.firstCallerTurn);
  const bargeText = cleanTurn(input.bargeText || firstCallerTurn);
  const bargedJob = input.bargedJob === true && looksLikeJobNoun(bargeText);
  const goal = firstTurnHasGoal(firstCallerTurn);

  let bucket = null;
  if (durationSeconds != null && durationSeconds < FLASH_SECONDS && !hasStt) {
    bucket = 'flash';
  } else if (bargedJob) {
    bucket = 'barged_job';
  } else if (goal) {
    bucket = 'first_turn_goal';
  } else if (
    greetingPlayed &&
    !hasStt &&
    durationSeconds != null &&
    durationSeconds < GREETING_DROP_SECONDS
  ) {
    bucket = 'heard_greeting_drop';
  }

  const connectMs = Number(input.connectToGreetingPcmMs);
  return {
    bucket,
    judge: JUDGED_BUCKETS.includes(bucket),
    greeting_played: greetingPlayed,
    has_stt: hasStt,
    duration_seconds: durationSeconds,
    connect_to_greeting_pcm_ms:
      Number.isFinite(connectMs) && connectMs >= 0 ? Math.round(connectMs) : null,
    first_turn: firstCallerTurn || null,
  };
}

module.exports = {
  FLASH_SECONDS,
  GREETING_DROP_SECONDS,
  FIRST_FORWARD_BUCKETS,
  JUDGED_BUCKETS,
  looksLikeJobNoun,
  looksLikeHangupOnly,
  firstTurnHasGoal,
  classifyFirstForwardAcceptance,
};
