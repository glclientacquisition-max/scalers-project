// Backend speech for a name-confirm turn, and for a later turn where a
// caller who is already name-confirmed asks what is still open.
// The model must not speak on those turns. These lines use only fields present.

const STATUS = /^(requested|confirmed|open|pending|cancelled|canceled|done|completed)$/i;
const LEAD = /^(request|hold|enquiry|inquiry)$/i;

function languageOf(language) {
  const value = String(language || '').trim().toLowerCase();
  if (value === 'sw' || value === 'sheng') return value;
  return 'en';
}

function bitsOf(line) {
  return String(line || '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !STATUS.test(part));
}

function sentence(bits, language, kind) {
  const parts = bits[0] && LEAD.test(bits[0]) ? bits.slice(1) : bits;
  const job = parts[0] || '';
  const when = parts[1] || '';
  const place = parts[2] || '';
  if (!job) return '';
  const tail = [when, place].filter(Boolean);
  const detail = tail.length ? `, ${tail.join(', ')}` : '';
  if (language === 'sw') {
    const lead = kind === 'request' ? `Una ombi la ${job}` : `Una ${job}`;
    return `${lead}${detail}.`;
  }
  if (language === 'sheng') {
    const lead = kind === 'request' ? `Uko na request ya ${job}` : `Uko na ${job}`;
    return `${lead}${detail}.`;
  }
  const lead = kind === 'request' ? `You have a ${job} request` : `You have ${job}`;
  return `${lead}${detail}.`;
}

function question(language) {
  if (language === 'sw') return 'Ungependa nifanye nini?';
  if (language === 'sheng') return 'Unataka nifanye nini?';
  return 'What would you like to do?';
}

function nothingOpen(language) {
  if (language === 'sw') return 'Hakuna kilicho wazi.';
  if (language === 'sheng') return 'Hakuna kitu iko open.';
  return 'Nothing is still open.';
}


// Lookup of visits already on file. Caller text only.
// Not a new booking, a change, a cancel, hours, or a services menu.
const LOOKUP_BLOCK_RE =
  /\b(?:cancel(?:led|lation)?|reschedul\w*|change|move|badilisha|ahirisha|kughairi|kubadilisha|book(?:\s+(?:a|an|me|us))?|schedule(?:\s+(?:a|an))?|(?:want|need|like) to book|what time|when (?:do|are) you open|opening hours|business hours|which services|what services|services do you offer|what do you offer)\b/i;

const LOOKUP_RE =
  /\b(?:inquire about (?:my |our )?(?:bookings?|visits?|appointments?)|(?:my|our) bookings?|do i have (?:a |any )?(?:visits?|bookings?|appointments?)|what are my (?:bookings?|visits?|appointments?)|check (?:on )?(?:my |our )?(?:bookings?|visits?|appointments?)|bookings zangu|booking yangu|ziara zangu)\b/i;

function looksLikeOpenVisitLookup(text) {
  const raw = String(text || '').trim();
  if (!raw || LOOKUP_BLOCK_RE.test(raw)) return false;
  return LOOKUP_RE.test(raw);
}

function openLineHoldDecision({
  nameConfirmed = false,
  nameJustConfirmed = false,
  callerText = '',
} = {}) {
  const just = nameJustConfirmed === true;
  const lookup =
    nameConfirmed === true && !just && looksLikeOpenVisitLookup(callerText);
  return {
    holdNameConfirm: just,
    holdVisitLookup: lookup,
    holdSpeech: just || lookup,
  };
}

function formatNameConfirmSpeech({
  openVisits = [],
  openRequests = [],
  language = 'en',
} = {}) {
  const lang = languageOf(language);
  const lines = [];
  for (const visit of Array.isArray(openVisits) ? openVisits : []) {
    const said = sentence(bitsOf(visit), lang, 'visit');
    if (said) lines.push(said);
  }
  for (const row of Array.isArray(openRequests) ? openRequests : []) {
    const said = sentence(bitsOf(row), lang, 'request');
    if (said) lines.push(said);
  }
  if (!lines.length) return `${nothingOpen(lang)} ${question(lang)}`;
  return `${lines.join(' ')} ${question(lang)}`;
}

module.exports = {
  formatNameConfirmSpeech,
  looksLikeOpenVisitLookup,
  openLineHoldDecision,
};
