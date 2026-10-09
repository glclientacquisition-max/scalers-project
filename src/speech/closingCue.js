'use strict';

// Closing cues: the caller is wrapping up.
//
// HD_ceba9d9b3f37: "Okay, thank you." got a long re-read of the file and the
// service list; the "That's all." after it waited behind that reply, and
// the caller hung up before the goodbye. HD_1677e57f73f9: "Sawa, ni hayo tu.
// Baadaye basi." got another question. Brain's sign-off check matches a
// bare "that's all" / "bye"; it does not see "asante", "hiyo tu", or a cue
// wrapped in "okay" / "sawa". Voice routes those to the close path:
//   - an end cue ("that's all", "hiyo tu", "baadaye basi", "bye") closes
//     the call (Brain END: farewell, then hangup);
//   - a thanks ("thank you", "asante") gets one short "anything else?"
//     unless the agent just asked a yes/no question (then "thank you" can
//     mean yes, and the turn goes on as normal). A second thanks, a bare
//     "no", or an end cue after that check closes the call.
// The whole utterance has to be closing words. "Thank you, what about the
// price?" is not a closing cue.

const FILLERS = [
  'okay', 'ok', 'okey', 'alright', 'all right', 'right', 'sawa', 'sawa sawa', 'poa', 'fine',
  'um', 'umm', 'uh', 'ah', 'eh', 'mm', 'mhm', 'hmm', 'so', 'well', 'then', 'basi', 'yeah', 'yes', 'ndio', 'ndiyo',
  'oh', 'great', 'perfect', 'good', 'nice', 'cool', 'sir', 'madam', 'boss',
];

const SOFT = [
  'thank you very much', 'thank you so much', 'thank you', 'thanks a lot', 'thanks so much', 'thanks', 'thank u',
  'asante sana', 'asante', 'shukran', 'shukrani', 'nashukuru', 'much appreciated', 'appreciate it',
];

const END = [
  "that's all for now", "that's all", 'that is all', 'that will be all', "that'll be all", "that's it", 'that is it',
  'bye bye', 'goodbye', 'good bye', 'bye', 'kwaheri', 'tutaonana', 'see you', 'see you later', 'talk later',
  'have a good day', 'have a nice day',
  'baadaye basi', 'ni hayo tu', 'ni hiyo tu', 'hayo tu', 'hiyo tu', 'ni hayo', 'hiyo ndiyo yote',
  'ni hayo tu basi', 'hiyo tu basi',
  'nothing else', 'no nothing else', 'hakuna kingine', 'hakuna lingine', "i'm done", 'im done', 'i am done',
  "no that's all", "no that's it",
];
// Not end cues on their own: "no thanks" (declines an offer), "hakuna" /
// "later" / "that's fine" (answers to a question). They close only after
// the "anything else?" check.

// After "Anything else?": a bare no is a close.
const NEGATIVE = ['no', 'nope', 'nah', 'hapana', 'la', 'no sir', 'not really', 'sio', 'hamna', 'hakuna'];

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2019\u2018`]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const byLength = (rows) => rows.map(normalise).sort((a, b) => b.split(' ').length - a.split(' ').length);
const FILLER_ROWS = byLength(FILLERS);
const SOFT_ROWS = byLength(SOFT);
const END_ROWS = byLength(END);
const NEGATIVE_ROWS = byLength(NEGATIVE);

function takeHead(words, rows) {
  for (const row of rows) {
    const parts = row.split(' ');
    if (parts.length > words.length) continue;
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      if (words[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return parts.length;
  }
  return 0;
}

/**
 * @param {string} text caller utterance
 * @returns {{ cue: ''|'soft'|'end'|'negative', end: boolean, soft: boolean }}
 *   'end': end words (with any thanks / fillers); 'soft': thanks only;
 *   'negative': a bare no; '' otherwise.
 */
function classifyClosingCue(text) {
  const words = normalise(text).split(' ').filter(Boolean);
  if (!words.length) return { cue: '', end: false, soft: false };
  let end = false;
  let soft = false;
  let negative = false;
  let i = 0;
  while (i < words.length) {
    const rest = words.slice(i);
    let n = takeHead(rest, END_ROWS);
    if (n) {
      end = true;
      i += n;
      continue;
    }
    n = takeHead(rest, SOFT_ROWS);
    if (n) {
      soft = true;
      i += n;
      continue;
    }
    n = takeHead(rest, NEGATIVE_ROWS);
    if (n) {
      negative = true;
      i += n;
      continue;
    }
    n = takeHead(rest, FILLER_ROWS);
    if (n) {
      i += n;
      continue;
    }
    return { cue: '', end: false, soft: false };
  }
  if (end) return { cue: 'end', end: true, soft };
  // "No, thank you" declines; like a thanks it gets the "anything else?" check.
  if (soft) return { cue: 'soft', end: false, soft: true };
  if (negative) return { cue: 'negative', end: false, soft: false };
  return { cue: '', end: false, soft: false };
}

const YES_NO_HEAD =
  /^(?:shall|should|do|does|did|can|could|would|will|is|are|am|was|have|has|may|want|ungependa|unataka|je|nikuwekee|nikuandikie|nikubukie|nikuhifadhie|naweza|niweke|tuweke|niko|uko|ni\s+sawa)\b/i;

/** The last agent sentence is a yes/no question ("Shall I book it?"). */
function agentAskedYesNo(lastAgentText) {
  const text = String(lastAgentText || '').trim();
  if (!/\?\s*$/.test(text)) return false;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = String(sentences[sentences.length - 1] || '').replace(/^(?:okay|ok|sawa|so|and|alright)[,\s]+/i, '');
  if (/\bor\b|\bau\b|\bama\b/i.test(last)) return false; // "this or something else?" is not yes/no
  return YES_NO_HEAD.test(last);
}

const CLOSING_CHECK = {
  en: 'Is there anything else I can help you with?',
  sw: 'Kuna kingine naweza kukusaidia nacho?',
  sheng: 'Kuna kitu ingine naweza kusaidia?',
};

function closingCheckLine(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sheng') return CLOSING_CHECK.sheng;
  if (lang === 'sw' || lang.startsWith('swahili')) return CLOSING_CHECK.sw;
  return CLOSING_CHECK.en;
}

/**
 * Voice close routing for one caller turn, after Brain decided.
 * @param {{
 *   text: string,
 *   brainAction?: string,
 *   lastAgentText?: string,
 *   closingCheckAsked?: boolean,
 *   language?: string,
 * }} opts
 * @returns {{ action: 'none'|'end'|'check', cue: string, line?: string, reason: string }}
 */
function planClosingCue(opts = {}) {
  const { cue } = classifyClosingCue(opts.text);
  if (String(opts.brainAction || '').toUpperCase() === 'END') {
    return { action: 'none', cue, reason: 'brain_end' };
  }
  if (cue === 'end') return { action: 'end', cue, reason: 'closing_cue' };
  if (opts.closingCheckAsked && (cue === 'soft' || cue === 'negative')) {
    return { action: 'end', cue, reason: 'after_closing_check' };
  }
  if (cue === 'soft') {
    if (agentAskedYesNo(opts.lastAgentText)) return { action: 'none', cue, reason: 'thanks_after_yes_no' };
    return { action: 'check', cue, line: closingCheckLine(opts.language), reason: 'thanks' };
  }
  return { action: 'none', cue, reason: '' };
}

module.exports = {
  classifyClosingCue,
  agentAskedYesNo,
  closingCheckLine,
  planClosingCue,
};
