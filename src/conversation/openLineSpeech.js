// Backend speech for the turn right after the caller confirms their name.
// The model must not speak on that turn. These lines use only fields present.

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
};
