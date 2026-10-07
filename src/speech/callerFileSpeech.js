const { confirmationLanguage } = require('../conversation/language');

// Speak gate for the caller file. Brain owns bind.
// The flag is `caller.nameConfirmed` (Brain PR #586). A parallel `speaker`
// object does not open or close the mouth. Voice does not write the flag.

const IDENTITY_ASK_RE =
  /\b(?:am i speaking with|je,?\s+naongea na|naongea na|unaongea na)\b/i;

const OPEN_ROW_RE =
  /\b(?:open (?:carpet |cleaning )?(?:request|requests|visit|visits|booking|bookings)|carpet cleaning requests?|two open|requests? (?:are )?open|on (?:your|the) file)\b/i;

function speakerBound(state) {
  return state?.caller?.nameConfirmed === true;
}

function escapeName(name) {
  return String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fileNames(state) {
  const speaker = state?.speaker;
  const raw = [
    speaker?.pendingName,
    speaker?.name,
    state?.caller?.fileNameAsked,
    state?.returning?.fileOwnerName,
    state?.returning?.boundName,
    state?.returning?.name,
  ];
  const names = [];
  for (const value of raw) {
    const name = String(value || '').trim();
    if (name.length < 2 || names.some((row) => row.toLowerCase() === name.toLowerCase())) {
      continue;
    }
    names.push(name);
  }
  return names;
}

function sentenceUsesFileName(sentence, names) {
  for (const name of names) {
    const re = new RegExp(`\\b${escapeName(name)}\\b`, 'i');
    if (re.test(sentence)) return true;
  }
  return false;
}

function splitSentences(text) {
  const parts = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [];
}

/**
 * Drop vocative file name and open-row claims until the speaker is bound.
 * The identity ask itself may say the pending name.
 * @returns {{ speak: boolean, line: string, reason: string }}
 */
function gateCallerFileSpeech(line, state) {
  const text = String(line || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { speak: false, line: '', reason: 'empty' };
  if (speakerBound(state)) return { speak: true, line: text, reason: 'bound' };

  const names = fileNames(state);
  const kept = [];
  let blocked = false;
  for (const sentence of splitSentences(text)) {
    if (IDENTITY_ASK_RE.test(sentence)) {
      kept.push(sentence);
      continue;
    }
    if ((names.length > 0 && sentenceUsesFileName(sentence, names)) || OPEN_ROW_RE.test(sentence)) {
      blocked = true;
      continue;
    }
    kept.push(sentence);
  }
  const next = kept.join(' ').trim();
  if (!next) return { speak: false, line: '', reason: blocked ? 'unbound' : 'empty' };
  return { speak: true, line: next, reason: blocked ? 'trimmed' : 'open' };
}

const { authorizeSpeak, createSpeakCommit } = require('./speakPacket');

function lineIsOpenFileRow(line) {
  return OPEN_ROW_RE.test(String(line || ''));
}

/**
 * Text of a public or step-up packet. Private replies are empty.
 * The name ask is not included here.
 * @param {{ outcome?: string, line?: string } | null} [localReply]
 */
function answerBeforeNameAsk(localReply) {
  const packet = authorizeSpeak(localReply);
  return packet ? packet.text : '';
}

/**
 * A file price the name gate did not speak. Cleared when that line is in the
 * spoken lines. A later name Yes reads it back.
 * @param {object} state
 * @param {{ outcome?: string, line?: string } | null} [localReply]
 * @param {string[]} [spokenLines]
 * @returns {string}
 */
function rememberUnspokenPrice(state, localReply, spokenLines) {
  if (!state || typeof state !== 'object') return '';
  if (!state.conversation || typeof state.conversation !== 'object') {
    state.conversation = {};
  }
  const line = String(localReply?.line || '').replace(/\s+/g, ' ').trim();
  if (String(localReply?.outcome || '') !== 'price' || !line) {
    return String(state.conversation.pendingFilePrice || '').trim();
  }
  const spoken = (Array.isArray(spokenLines) ? spokenLines : []).some(
    (row) => String(row || '').replace(/\s+/g, ' ').trim() === line
  );
  state.conversation.pendingFilePrice = spoken ? '' : line;
  return state.conversation.pendingFilePrice;
}

/**
 * The file price still waiting after they confirm the name. Empty once spoken,
 * and empty on any later turn.
 * @param {object} [state]
 * @returns {string}
 */
function pendingPriceAfterNameYes(state) {
  if (state?.caller?.nameJustConfirmed !== true) return '';
  return String(state?.conversation?.pendingFilePrice || '').replace(/\s+/g, ' ').trim();
}

/**
 * Name-ask early return order: kept public answer, then the ask.
 * The ask is last so it is the committed question.
 * @param {{
 *   localReply?: { outcome?: string, line?: string } | null,
 *   nameAsk?: string,
 *   state?: object,
 * }} [opts]
 */
function linesBeforeNameAsk(opts = {}) {
  const commit = createSpeakCommit();
  const packet = authorizeSpeak(opts.localReply);
  if (packet) commit.commit(packet);
  return commit.drain({
    nameAsk: opts.nameAsk,
    nameJustConfirmed: opts.nameJustConfirmed === true,
    state: opts.state,
  });
}

/**
 * The file-name ask speaks in the caller's current language.
 * English and Kiswahili are the packs Brain already binds on.
 * @param {string} line
 * @param {string} [language]
 */
function lockFileNameAsk(line, language) {
  const text = String(line || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const match = text.match(
    /^(?:am i speaking with|je,?\s*naongea na|naongea na|unaongea na)\s+(.+?)\s*\??$/i
  );
  if (!match) return text;
  const who = match[1].replace(/[?.!,]+$/g, '').trim();
  if (!who) return text;
  const lang = confirmationLanguage(language);
  if (lang === 'sw' || lang === 'sheng') return `Je, naongea na ${who}?`;
  return `Am I speaking with ${who}?`;
}

module.exports = {
  speakerBound,
  gateCallerFileSpeech,
  lineIsOpenFileRow,
  answerBeforeNameAsk,
  linesBeforeNameAsk,
  lockFileNameAsk,
  rememberUnspokenPrice,
  pendingPriceAfterNameYes,
};
