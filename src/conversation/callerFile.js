// Node id: caller_file
// Single place that owns the visit-existence sentence. The model must not
// invent open visits or claim there is no booking. Code speaks every still-
// open row (fields that exist only), or the existing empty-file line.

const {
  looksLikeFileRead,
  nothingOnFileLine,
  markNothingOnFile,
} = require('./fileRead');

const NODE_ID = 'caller_file';

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

function followUpQuestion(language) {
  if (language === 'sw') return 'Ungependa nifanye nini?';
  if (language === 'sheng') return 'Unataka nifanye nini?';
  return 'What would you like to do?';
}

function openRowsOf(returning) {
  if (!returning || typeof returning !== 'object') {
    return { visits: [], requests: [] };
  }
  const visits = Array.isArray(returning.openVisits) && returning.openVisits.length
    ? returning.openVisits.filter(Boolean)
    : returning.nextVisit
      ? [returning.nextVisit]
      : returning.nextAppointment
        ? [returning.nextAppointment]
        : [];
  const requests = Array.isArray(returning.openRequests)
    ? returning.openRequests.filter(Boolean)
    : [];
  return { visits, requests };
}

/**
 * Code-built spoken line for every still-open row. Empty string when there
 * is nothing open (caller must not hear a fabricated visit or a model denial).
 */
function formatOpenRowsSpeech({ returning = null, language = 'en' } = {}) {
  const lang = languageOf(language);
  const { visits, requests } = openRowsOf(returning);
  const lines = [];
  for (const visit of visits) {
    const said = sentence(bitsOf(visit), lang, 'visit');
    if (said) lines.push(said);
  }
  for (const row of requests) {
    const said = sentence(bitsOf(row), lang, 'request');
    if (said) lines.push(said);
  }
  if (!lines.length) return '';
  return `${lines.join(' ')} ${followUpQuestion(lang)}`.trim();
}

/**
 * Visit-existence speech owned by caller_file.
 * - Open rows: every still-open line, fields present only, call language.
 * - Empty file on a lookup: existing nothingOnFileLine (e.g. "I don't have a booking for you.").
 * - Empty file on save_caller_info: '' (no invented denial).
 */
function callerFileSpeech({
  state = {},
  language,
  mode = 'lookup',
  callerText = '',
} = {}) {
  const lang = languageOf(language || state?.language?.current || 'en');
  const returning = state?.returning || null;
  const openSpeech = formatOpenRowsSpeech({ returning, language: lang });
  if (openSpeech) return openSpeech;

  if (mode === 'save') return '';

  if (mode === 'lookup' || looksLikeFileRead(callerText)) {
    markNothingOnFile(state);
    return nothingOnFileLine(state, lang);
  }
  return '';
}

/**
 * Whether this turn's speech for visit existence must come from caller_file
 * (already-bound open rows, empty-file lookup, or after save_caller_info).
 */
function callerFileOwnsSpeech({
  state = {},
  callerText = '',
  toolResults = [],
} = {}) {
  const saved = (Array.isArray(toolResults) ? toolResults : []).some(
    (result) => result?.action === 'save_caller_info' && result.status !== 'duplicate'
  );
  if (saved) return true;
  if (looksLikeFileRead(callerText)) return true;
  return false;
}

/**
 * Local file-read reply before Gemini. Bound files with open rows speak the
 * code line. Empty files keep the existing nothing-on-file sentence.
 * The model never decides whether a visit exists.
 */
function callerFileLocalReply({ text = '', state = {}, language } = {}) {
  if (!looksLikeFileRead(text)) return null;
  const line = callerFileSpeech({
    state,
    language,
    mode: 'lookup',
    callerText: text,
  });
  if (!line) return null;
  return { outcome: 'file_read', line, node: NODE_ID };
}

module.exports = {
  NODE_ID,
  callerFileLocalReply,
  callerFileOwnsSpeech,
  callerFileSpeech,
  formatOpenRowsSpeech,
  openRowsOf,
};
