// A caller question owns its turn (HD_cd0c01f28b05).
//
// Staging call HD_cd0c01f28b05: the caller asked "What time is it?" and the
// stored-name gate answered with only "Am I speaking with Alwyn?". The question
// was never answered. Three turns of name spelling followed, and the time
// answer the model wrote at the end was dropped.
//
// Rule: when the caller's turn is a public question that no local fact line
// answers this turn (the clock, the date, a general question), the file-name
// confirmation waits. The model answers this turn. The name ask stays due and
// fires on the next turn that is not such a question.
//
// The name ask is NOT deferred for:
//  - a question about the caller's own file ("When is my booking?"). The name
//    check exists to unlock that file, so it still comes first.
//  - a booking turn ("Can you come tomorrow?"). The name belongs to the booking.
//  - a knowledge ask that already has a local fact line (hours, price, services,
//    location). That line is spoken first and the ask follows. This is unchanged.
//
// VOICE_QUESTION_BEFORE_NAME: on by default. Set it to off to restore the old gate.

const { callerClockAsk } = require('./trustedFacts');
const { callerTurnKinds } = require('./messageOnly');
const { looksLikeHoursAsk } = require('./knownFacts');

function questionBeforeNameEnabled(env = process.env) {
  const raw = String(env.VOICE_QUESTION_BEFORE_NAME == null ? 'on' : env.VOICE_QUESTION_BEFORE_NAME)
    .trim()
    .toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false' || raw === 'no');
}

const LEAD_IN = String.raw`(?:(?:uh+|um+|er+|so|okay|ok|hi|hello|hey|yes|yeah|and|but|sorry|please|excuse me|sawa|eeh|basi|niaje|sasa|habari)[\s,.!]+)*`;

const QUESTION_LEAD = new RegExp(
  `^${LEAD_IN}(?:what|what's|whats|when|where|which|who|whom|whose|why|how|is (?:it|there|this|that)|are (?:you|there|they)|do (?:you|they)|does|did|can (?:you|i|we)|could (?:you|i)|will (?:you|it)|would (?:you|it)|should|may i|have you|has|nini|gani|wapi|lini|vipi|je|kwa nini|ni nini|ni saa|ni wapi|ni lini|mnauza|mna|mko|una|mnafanya|mnafungua|mnafunga|naweza|tunaweza)\\b`,
  'i'
);
const SW_QUESTION_WORD = /\b(ngapi|gani|wapi|lini|vipi|nini|je)\b/i;

// The caller's own file: name confirmation unlocks it, so the ask comes first.
const PERSONAL_FILE =
  /\b(?:my|our|mine)\b[^.?!]{0,30}\b(?:booking|bookings|appointment|appointments|visit|visits|order|orders|request|requests|delivery|deliveries|account|ticket|job|cleaner|technician|refund|payment|payments|receipt|invoice|file|details|record|records|balance|item|items|package|parcel)\b|\b(?:booking|appointment|visit|order|ombi|oda|miadi|ziara|malipo|akaunti|kifurushi|mzigo|risiti)\s+(?:yangu|wangu|yetu|langu|letu|zangu|changu|chetu)\b/i;

function personalFileAsk(text) {
  const raw = String(text || '');
  if (PERSONAL_FILE.test(raw)) return true;
  try {
    // eslint-disable-next-line global-require
    return require('./callFixesD199').looksLikeFileAsk(raw) === true;
  } catch {
    return false;
  }
}

/**
 * The kind of public question in the caller's turn that the model must answer
 * before the name ask: 'time', 'date', 'question', or '' when the name ask may
 * run (no question, a file question, a booking turn, or a knowledge ask that a
 * local fact line already answers).
 */
function questionOwnsTurn(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (personalFileAsk(raw)) return '';
  const clock = callerClockAsk(raw);
  if (clock) return clock;
  const kinds = callerTurnKinds(raw);
  if (kinds.knowledge || looksLikeHoursAsk(raw)) return '';
  if (kinds.booking) return '';
  const words = raw.split(/\s+/).filter(Boolean).length;
  if (/\?\s*$/.test(raw) && (QUESTION_LEAD.test(raw) || SW_QUESTION_WORD.test(raw)) && words >= 2) {
    return 'question';
  }
  if (QUESTION_LEAD.test(raw) && words >= 3) return 'question';
  return '';
}

module.exports = {
  questionBeforeNameEnabled,
  questionOwnsTurn,
  personalFileAsk,
};
