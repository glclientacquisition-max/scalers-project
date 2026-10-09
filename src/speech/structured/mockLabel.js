// Build a MOCK structured reply from a recorded legacy Gemini reply, for
// replay only. say[] is the recorded text split into sentences, verbatim.
// lang is the turn's lock; intent and facts_used are auto-labelled from the
// tenant fact table. This is not what Gemini returns under responseSchema:
// it replays real model sentences through the structured checks and
// boundary. Real recordings come from `replay-voice-suite --live --record`.

const { parseGeminiResponse } = require('../../conversation/toolMarkers');
const { statedNumbers } = require('./numbers');
const { MAX_SAY } = require('./schema');

function splitSentences(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  return (raw.match(/[^.!?]+[.!?]+["'”’)]*|[^.!?]+$/g) || [raw]).map((s) => s.trim()).filter(Boolean);
}

function labelWords(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !['cleaning', 'service', 'services', 'standard'].includes(word));
}

/** Facts a sentence states, cited the way a correct model would cite them. */
function citeFacts(sentence, table) {
  const text = String(sentence || '').toLowerCase();
  const numbers = [...statedNumbers(sentence)];
  const cited = [];
  for (const entry of table?.entries || []) {
    let hit = false;
    if (entry.kind === 'coverage') hit = text.includes(String(entry.label).toLowerCase());
    else if (entry.kind === 'service') {
      const words = labelWords(entry.label);
      const named = words.length > 0 && words.every((word) => text.includes(word));
      const priced = numbers.length > 0 && numbers.some((n) => entry.numbers.has(n));
      // A price stated in another language ("kapeti ... 1500 hadi 2000") is
      // cited when every figure in the sentence belongs to this row.
      const allFigures = numbers.length > 0 && numbers.every((n) => entry.numbers.has(n));
      hit = named || (priced && words.some((word) => text.includes(word))) || allFigures;
    } else if (entry.kind === 'hours') hit = /\b(open|hours|saa)\b/i.test(text);
    if (hit && !cited.some((row) => row.id === entry.id)) {
      cited.push({ kind: entry.kind === 'service' && numbers.length ? 'price' : entry.kind, id: entry.id });
    }
  }
  return cited;
}

function guessIntent(sentences, factsUsed) {
  const text = sentences.join(' ').toLowerCase();
  if (factsUsed.some((f) => f.kind === 'coverage')) return 'coverage';
  if (factsUsed.some((f) => f.kind === 'price')) return 'price';
  if (factsUsed.filter((f) => f.kind === 'service').length >= 2) return 'services';
  if (/\b(book|schedule|day and time|visit)\b/.test(text)) return 'booking';
  if (/\b(name|speaking with|jina)\b/.test(text)) return 'identity';
  return 'other';
}

function toolFromMarkers(rawText) {
  const match = String(rawText || '').match(/###TOOL###([\s\S]*?)###ENDTOOL###/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    const name = Object.keys(parsed)[0];
    return name ? { name, args_json: JSON.stringify(parsed[name]) } : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} legacyText recorded Gemini text (may carry ###TOOL### markers)
 * @param {{ table: object, locked: string }} ctx
 */
function mockStructuredReply(legacyText, { table, locked }) {
  const parsed = parseGeminiResponse(legacyText);
  const sentences = splitSentences(parsed.spokenText);
  const say = sentences.length > MAX_SAY ? sentences.slice(0, MAX_SAY) : sentences;
  const factsUsed = [];
  for (const sentence of say) {
    for (const fact of citeFacts(sentence, table)) {
      if (!factsUsed.some((row) => row.id === fact.id)) factsUsed.push(fact);
    }
  }
  const tool = toolFromMarkers(legacyText);
  return {
    lang: locked,
    intent: guessIntent(say, factsUsed),
    facts_used: factsUsed,
    say,
    ...(tool ? { tool } : {}),
    ...(parsed.shouldEndCall ? { end_call: true } : {}),
  };
}

/** Sentences beyond maxItems that a mock had to leave out (schema caps say at 3). */
function mockTrimmed(legacyText) {
  const sentences = splitSentences(parseGeminiResponse(legacyText).spokenText);
  return sentences.slice(MAX_SAY);
}

module.exports = { mockStructuredReply, mockTrimmed, splitSentences, citeFacts };
