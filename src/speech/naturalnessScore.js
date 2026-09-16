// Score live DID transcripts for Voice-owned robotic artifacts.
// This is not a MOS guess and not a TTS-speed knob. Listen + transcript +
// spoken= logs decide. Brain wording is tagged, not "fixed" here.

const TINY_LEAD_IN =
  /^(sure|great|okay|ok|alright|thanks|thank you|i'?m listening|mm-hmm|mm|sawa|poa|got it)[.!]*$/i;

const HYPHEN_GIVEN_NAME = /\b[A-Z][a-z]{1,5}-[a-z]{2,8}\b/;
const KEEP_HYPHEN = /^(air-tel|m-pesa|e-citizen|kris-to-fa|sar-tu-day)$/i;

const PUNCTUATION_LEAK =
  /(\s[-–—]\s)|(\.\s*\.\s*\.)|(\u2014)|(\be\.g\.)|(\bi\.e\.)|(\band\/or\b)|(&)/;

const LIST_LEAK =
  /\b(couch|carpet|mattress).{0,40}\b(couch|carpet|mattress)\b/i;

const PHATIC_CALLER = /\b(how are you|how're you|how are you doing)\b/i;

/**
 * @param {string} text
 */
function normalizeTurn(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTinyLeadIn(text) {
  return TINY_LEAD_IN.test(normalizeTurn(text).replace(/[!]+$/g, '.'));
}

function hyphenGivenNameHits(text) {
  const src = String(text || '');
  const hits = src.match(new RegExp(HYPHEN_GIVEN_NAME, 'g')) || [];
  return hits.filter((h) => !KEEP_HYPHEN.test(h));
}

/**
 * Score one agent utterance (desk transcript row or one spoken= chunk).
 * @param {string} text
 * @param {{ spoken?: string, prevCaller?: string }} [opts]
 * @returns {{ id: string, lane: 'voice'|'brain', detail: string }[]}
 */
function scoreAgentTurn(text, opts = {}) {
  const spoken = normalizeTurn(opts.spoken != null ? opts.spoken : text);
  const heard = normalizeTurn(text);
  const prevCaller = normalizeTurn(opts.prevCaller || '');
  /** @type {{ id: string, lane: 'voice'|'brain', detail: string }[]} */
  const flags = [];

  if (isTinyLeadIn(heard) || isTinyLeadIn(spoken)) {
    flags.push({
      id: 'V2',
      lane: 'voice',
      detail: `tiny lead-in as its own utterance: ${JSON.stringify(heard || spoken)}`,
    });
  }

  const hyphenHits = hyphenGivenNameHits(spoken).concat(hyphenGivenNameHits(heard));
  if (hyphenHits.length) {
    flags.push({
      id: 'V3',
      lane: 'voice',
      detail: `hyphenated given-name say-form: ${hyphenHits.join(', ')}`,
    });
  }

  if (PUNCTUATION_LEAK.test(spoken) || PUNCTUATION_LEAK.test(heard)) {
    flags.push({
      id: 'V4',
      lane: 'voice',
      detail: 'punctuation leak (dash, dot chain, e.g., ampersand) still in spoken text',
    });
  }

  if (/^i'?m listening\b/i.test(heard) || /^i'?m listening\b/i.test(spoken)) {
    flags.push({
      id: 'V5',
      lane: 'voice',
      detail: 'thinking-ack / listen line spoken as its own turn',
    });
  }

  if (/\b(are you still there|bado uko|hello\??\s*$)/i.test(heard)) {
    flags.push({
      id: 'V6',
      lane: 'voice',
      detail: `idle poke: ${JSON.stringify(heard)}`,
    });
  }

  if (/\b(i('ll| will) speak (clearer|louder|more clearly)|improve (my )?volume)\b/i.test(heard)) {
    flags.push({
      id: 'V8',
      lane: 'voice',
      detail: 'claimed a volume change; Voice has no caller-driven gain',
    });
  }

  if (prevCaller && PHATIC_CALLER.test(prevCaller) && LIST_LEAK.test(heard)) {
    flags.push({
      id: 'B1',
      lane: 'brain',
      detail: 'service list on a how-are-you turn',
    });
  }

  return flags;
}

/**
 * Parse Railway `[soniox-tts]` / `[ws/media]` spoken= fields from log text.
 * @param {string} logs
 * @returns {string[]}
 */
function parseSpokenLogLines(logs) {
  const out = [];
  const re = /\bspoken="([^"]*)"/g;
  const src = String(logs || '');
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Score a whole call from desk turns plus optional spoken= log text.
 * @param {{
 *   turns?: { speaker?: string, text?: string, text_content?: string }[],
 *   spokenLogs?: string,
 *   spokenChunks?: string[],
 * }} input
 */
function scoreCall(input = {}) {
  const turns = Array.isArray(input.turns) ? input.turns : [];
  const spokenChunks = Array.isArray(input.spokenChunks)
    ? input.spokenChunks
    : parseSpokenLogLines(input.spokenLogs || '');

  /** @type {{ id: string, lane: 'voice'|'brain', detail: string, turn?: number }[]} */
  const flags = [];
  let prevCaller = '';

  turns.forEach((row, idx) => {
    const speaker = String(row.speaker || '').toLowerCase();
    const text = row.text != null ? row.text : row.text_content;
    if (speaker === 'caller') {
      prevCaller = normalizeTurn(text);
      return;
    }
    if (speaker && speaker !== 'agent' && speaker !== 'assistant') return;
    const turnFlags = scoreAgentTurn(text, { prevCaller });
    for (const f of turnFlags) flags.push({ ...f, turn: idx });
  });

  spokenChunks.forEach((chunk, idx) => {
    const chunkFlags = scoreAgentTurn(chunk, { spoken: chunk }).filter((f) =>
      ['V2', 'V3', 'V4', 'V5'].includes(f.id)
    );
    for (const f of chunkFlags) {
      flags.push({ ...f, detail: `${f.detail} (spoken[${idx}])` });
    }
  });

  const voiceFails = flags.filter((f) => f.lane === 'voice');
  const brainNotes = flags.filter((f) => f.lane === 'brain');
  const uniqueVoice = [...new Set(voiceFails.map((f) => f.id))];

  return {
    pass: uniqueVoice.length === 0,
    voiceFailIds: uniqueVoice,
    voiceFails,
    brainNotes,
    spokenChunkCount: spokenChunks.length,
    agentTurns: turns.filter((t) => /agent|assistant/i.test(String(t.speaker || 'agent'))).length,
  };
}

module.exports = {
  TINY_LEAD_IN,
  isTinyLeadIn,
  scoreAgentTurn,
  scoreCall,
  parseSpokenLogLines,
};
