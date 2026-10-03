// A caller asking what is already saved is not a new booking or order.
// Home services and retail share this. If nothing is on file for this
// speaker, say so. Do not let the model invent a visit, a hold, or a menu.

const {
  looksLikeExistingVisitTalk,
  looksLikePastBookingTalk,
} = require('./visitTalk');

const FILE_READ_RE =
  /\b(what do i have|what have i got|which ones?(?:\s+do)? i have|which (?:booking|bookings|order|orders|hold|holds)|any (?:booking|bookings|order|orders|hold|holds)|is there any that i have|previous (?:booking|bookings|order|orders|hold)|my previous|check (?:for me )?(?:the |my )?(?:previous )?(?:booking|order|hold)|read (?:them|it|me|for me)|the one(?:s)? (?:that )?i have|ones i have|in place|bookings zangu|booking yangu|order yangu|hold yangu|oda yangu|niambie (?:booking|oda|order|hold)|what(?:'s| is) on hold|on hold for me|my (?:order|orders|hold|holds))\b/i;

const NEW_WORK_RE =
  /\b(want to book|like to book|need to book|please book|book me|can you book|could you book|i want to order|i'd like to order|order \d+|buy \d+|nataka (?:cleaning|carpet|couch|sofa|mattress|kuweka)|naomba (?:cleaning|carpet))\b/i;

const OFFER_ASK_RE =
  /\b(what (?:do you (?:offer|do|sell|have)|services|can you do)|which services|what services|services (?:that |do )?you (?:have|offer)|tell me the services|uniambie (?:the )?services|services mko nayo|mnauza|huduma (?:gani|mnazo|mko)|what do you offer)\b/i;

const INVENTED_FILE_RE =
  /\b(reschedule or cancel|cancel or reschedule|keep or change (?:that|them|it)|proceed with them|any of them)\b/i;

// Talks as if a saved job already exists. "Book a couch" does not match.
const PRESUPPOSE_RE =
  /\b(?:your|the|that|this|my) (?:booking|order|hold|visit)\b|\bbooking yako\b|\boda yako\b|\bkuhusu booking\b|\breschedule\b|\bcancel (?:it|them|that)\b|\bchange about it\b|\bkughairi\b|\bkubadilisha\b|\bwith your booking\b/i;

const EMPTY_FILE_FOLLOW_UP_RE =
  /\b(really|which one|what do you mean|failing me|read it|someni|usome)\b/i;

function looksLikeNewWork(text) {
  return NEW_WORK_RE.test(String(text || ''));
}

function looksLikeOfferAsk(text) {
  return OFFER_ASK_RE.test(String(text || ''));
}

function looksLikeFileRead(text) {
  const raw = String(text || '').trim();
  if (!raw || looksLikeNewWork(raw) || looksLikeOfferAsk(raw)) return false;
  if (FILE_READ_RE.test(raw)) return true;
  if (looksLikeExistingVisitTalk(raw) || looksLikePastBookingTalk(raw)) return true;
  return false;
}

function hasReadableFile(state) {
  const file = state?.returning;
  if (!file || !file.identityBound) return false;
  if (file.fileRole && file.fileRole !== 'primary') return false;
  if (file.nextVisit) return true;
  if (Array.isArray(file.openVisits) && file.openVisits.length > 0) return true;
  if (Array.isArray(file.openRequests) && file.openRequests.length > 0) return true;
  if (Array.isArray(file.recentBookings) && file.recentBookings.length > 0) return true;
  return false;
}

/**
 * Visit and hold rows are on the bound primary file. Until then, a lookup
 * must not be answered with an empty-file line.
 */
function fileRowsWereRead(state) {
  const file = state?.returning;
  if (!file || file.identityBound !== true) return false;
  if (file.fileRole && file.fileRole !== 'primary') return false;
  return true;
}

/**
 * Existing nothing-open line. Not a new denial.
 * Swahili and Sheng are the existing translations of this one line.
 */
function nothingStillOpenLine(state, language) {
  const lang = String(language || state?.language?.current || 'en').toLowerCase();
  if (lang === 'sw') return 'Hakuna kilicho wazi.';
  if (lang === 'sheng') return 'Hakuna kitu iko open.';
  return 'Nothing is still open.';
}

function nothingOnFileLine(state, language) {
  const lang = String(language || state?.language?.current || 'en').toLowerCase();
  const sw = lang === 'sw' || lang === 'sheng';
  const vertical = String(state?.vertical || '').toLowerCase();
  if (vertical === 'retail') {
    return sw ? 'Sina oda wala hold yako.' : "I don't have an order or a hold for you.";
  }
  if (vertical === 'home_services') {
    return sw ? 'Sina booking yako.' : "I don't have a booking for you.";
  }
  return sw ? 'Sina kitu kilichohifadhiwa kwako.' : "I don't have anything saved for you.";
}

/**
 * Fixed line when they asked what is saved and this speaker has nothing.
 * Empty when this is not a file read, or when a bound file has something
 * the model may read.
 * @returns {string}
 */
function looksLikeEmptyFileFollowUp(text) {
  const raw = String(text || '').trim();
  if (!raw || looksLikeNewWork(raw) || looksLikeOfferAsk(raw)) return false;
  if (raw.split(/\s+/).length > 14) return false;
  return EMPTY_FILE_FOLLOW_UP_RE.test(raw);
}

function markNothingOnFile(state) {
  if (!state || typeof state !== 'object') return;
  if (!state.conversation || typeof state.conversation !== 'object') state.conversation = {};
  state.conversation.toldNothingOnFile = true;
}

function fileReadLine({ text = '', state = {}, language } = {}) {
  if (hasReadableFile(state)) return '';
  const again =
    Boolean(state?.conversation?.toldNothingOnFile) && looksLikeEmptyFileFollowUp(text);
  if (!looksLikeFileRead(text) && !again) return '';
  // Do not return the empty-file line before the visit or hold rows are read.
  if (!fileRowsWereRead(state)) return '';
  markNothingOnFile(state);
  return nothingStillOpenLine(state, language);
}

function presupposesSavedWork(sentence) {
  const raw = String(sentence || '');
  if (/\b(don't have|do not have|sina |nothing saved|no booking|no order)\b/i.test(raw)) {
    return false;
  }
  return PRESUPPOSE_RE.test(raw) || INVENTED_FILE_RE.test(raw);
}

/**
 * Drop an unasked service menu, and drop a made-up "reschedule any of them"
 * when this speaker has nothing saved.
 * @param {string} text
 * @param {{ callerText?: string, state?: object, language?: string }} [opts]
 */
function sanitizeSpokenFileClaim(text, opts = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (hasReadableFile(opts.state)) return raw;
  const callerText = String(opts.callerText || '');
  if (looksLikeOfferAsk(callerText) && !presupposesSavedWork(raw)) return raw;
  const parts = raw.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = parts.filter((part) => !presupposesSavedWork(part));
  const out = kept.join(' ').trim();
  if (out && out !== raw) return out;
  if (!presupposesSavedWork(raw) && !looksLikeServiceMenu(raw)) return raw;
  if (looksLikeOfferAsk(callerText) && looksLikeServiceMenu(raw)) return raw;
  if (looksLikeServiceMenu(raw) && !looksLikeFileRead(callerText) && !looksLikeEmptyFileFollowUp(callerText)) {
    return raw;
  }
  if (!fileRowsWereRead(opts.state)) return '';
  return nothingStillOpenLine(opts.state, opts.language);
}

function looksLikeServiceMenu(text) {
  const nouns = [
    ...String(text || '').matchAll(
      /\b(carpet|couch|sofa|mattress|airbnb|upholstery|house cleaning|diary|diaries)\b/gi
    ),
  ].map((row) => String(row[0] || '').toLowerCase());
  return new Set(nouns).size >= 3;
}

const SPOKEN_STATUS = /^(requested|confirmed|open|pending|cancelled|canceled|done|completed|fulfilled)$/i;
const SPOKEN_LEAD = /^(request|hold|order|enquiry|inquiry)$/i;

function spokenBits(line) {
  return String(line || '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !SPOKEN_STATUS.test(part));
}

/**
 * Existing open-line sentence. Job and when. Place only when that field is
 * present. Not a new template.
 */
function speakSavedLine(line, language, kind) {
  const bits = spokenBits(line);
  const parts = bits[0] && SPOKEN_LEAD.test(bits[0]) ? bits.slice(1) : bits;
  const job = parts[0] || '';
  const when = parts[1] || '';
  const place = parts[2] || '';
  if (!job) return '';
  const tail = [when, place].filter(Boolean);
  const detail = tail.length ? `, ${tail.join(', ')}` : '';
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw') {
    const lead = kind === 'request' ? `Una ombi la ${job}` : `Una ${job}`;
    return `${lead}${detail}.`;
  }
  if (lang === 'sheng') {
    const lead = kind === 'request' ? `Uko na request ya ${job}` : `Uko na ${job}`;
    return `${lead}${detail}.`;
  }
  const lead = kind === 'request' ? `You have a ${job} request` : `You have ${job}`;
  return `${lead}${detail}.`;
}

function historyOnlyAsk(text) {
  const raw = String(text || '');
  if (!looksLikePastBookingTalk(raw)) return false;
  if (/\bupcoming\b/i.test(raw)) return false;
  if (/\bread (?:them|it)\b/i.test(raw)) return false;
  if (looksLikeExistingVisitTalk(raw) && !/\bprevious\b/i.test(raw)) return false;
  return true;
}

function priorCallerText(state) {
  return (state?.conversation?.answersReceived || []).slice(0, -1).join(' ');
}

/**
 * Backend read of the caller file. Empty string when this turn is not a
 * visit, hold, or order lookup. Nothing open and nothing recent is the
 * existing "Nothing is still open."
 */
function spokenFileRead({ text = '', state = {}, language } = {}) {
  const forced = Boolean(state?.conversation?.speakFileRead);
  if (state?.conversation) state.conversation.speakFileRead = false;
  if (!fileRowsWereRead(state)) return '';
  const current = String(text || '');
  const context = forced ? `${priorCallerText(state)} ${current}` : current;
  const upcoming = /\bupcoming\b/i.test(context);
  const readThem = /\bread (?:them|it)\b/i.test(current);
  const fileAsk = looksLikeFileRead(current) || looksLikePastBookingTalk(current) || upcoming || readThem;
  const followUp =
    Boolean(state?.conversation?.toldNothingOnFile) && looksLikeEmptyFileFollowUp(current);
  if (!forced && !fileAsk && !followUp) return '';
  const onlyHistory = !forced && historyOnlyAsk(current);
  const wantHistory = looksLikePastBookingTalk(context);
  const file = state.returning || {};
  const lines = [];
  if (!onlyHistory) {
    const visits = Array.isArray(file.openVisits) ? file.openVisits : [];
    for (const row of visits) {
      const said = speakSavedLine(row, language, 'visit');
      if (said) lines.push(said);
    }
    const requests = Array.isArray(file.openRequests) ? file.openRequests : [];
    for (const row of requests) {
      const said = speakSavedLine(row, language, 'request');
      if (said) lines.push(said);
    }
  }
  if (wantHistory || onlyHistory) {
    const recent = Array.isArray(file.recentBookings) ? file.recentBookings : [];
    for (const row of recent) {
      const kind = SPOKEN_LEAD.test(spokenBits(row)[0] || '') ? 'request' : 'visit';
      const said = speakSavedLine(row, language, kind);
      if (said && !lines.includes(said)) lines.push(said);
    }
  }
  if (!lines.length) {
    markNothingOnFile(state);
    return nothingStillOpenLine(state, language);
  }
  return lines.join(' ');
}

module.exports = {
  looksLikeFileRead,
  looksLikeNewWork,
  looksLikeOfferAsk,
  looksLikeServiceMenu,
  hasReadableFile,
  fileRowsWereRead,
  nothingOnFileLine,
  nothingStillOpenLine,
  spokenFileRead,
  fileReadLine,
  looksLikeEmptyFileFollowUp,
  presupposesSavedWork,
  sanitizeSpokenFileClaim,
};
