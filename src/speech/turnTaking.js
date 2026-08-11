// Turn-taking helpers: adaptive end-of-utterance flush + barge-in decisions.

const INCOMPLETE_TAIL =
  /\b(and|but|so|because|or|then|also|with|for|to|na|lakini|kwa|sababu|ama|halafu|then)\s*$/i;

const INTERRUPT_CUES =
  /\b(no|nope|wait|stop|hold on|actually|sorry|excuse me|hapana|simama|subiri|kusubiri|acha)\b/i;

const SHORT_CONFIRMS = new Set([
  'yes',
  'no',
  'yeah',
  'yep',
  'yup',
  'nope',
  'ok',
  'okay',
  'sawa',
  'ndiyo',
  'hapana',
  'correct',
  'right',
  'exactly',
  'poa',
]);

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function normalizeSpeech(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordSet(text) {
  return new Set(
    normalizeSpeech(text)
      .split(' ')
      .filter((w) => w.length > 1)
  );
}

/**
 * Echo detector: substring match or high word overlap with last agent line.
 * @param {string} callerText
 * @param {string} agentText
 */
function looksLikeEcho(callerText, agentText) {
  const a = normalizeSpeech(callerText);
  const b = normalizeSpeech(agentText);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b.slice(0, Math.min(40, b.length)))) return true;

  const aw = wordSet(a);
  const bw = wordSet(b);
  if (!aw.size || !bw.size) return false;
  let overlap = 0;
  for (const w of aw) {
    if (bw.has(w)) overlap += 1;
  }
  const ratio = overlap / aw.size;
  // Short echoes like hearing "how can I help" back as "can I help".
  return ratio >= 0.7 && overlap >= 2;
}

/**
 * True when the caller seems mid-thought (don't flush yet).
 * STT often sticks a period on trailing conjunctions ("room, and.") — strip that
 * before deciding the thought is complete.
 * @param {string} text
 */
function utteranceLooksIncomplete(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;

  // Live call HD_0cdf315f02e9: "executive room,and." was flushed mid-thought.
  const core = raw.replace(/[.!?,;:…]+$/g, '').trim();
  if (!core) return false;

  if (INCOMPLETE_TAIL.test(core) || INCOMPLETE_TAIL.test(raw)) return true;
  // Trailing comma / "and," without finishing the clause.
  if (/,\s*(and|but|so|or)?$/i.test(core)) return true;
  // "my name is" / "jina langu ni" without the name yet.
  if (/\b(my name is|i am|i'm|jina langu ni|ninaitwa)\s*$/i.test(core)) return true;
  return false;
}

/**
 * Pure barge / yield cues with no new request — after cancel, just listen.
 * @param {string} text
 */
function isInterruptOnlyUtterance(text) {
  const t = normalizeSpeech(text);
  if (!t) return false;
  // "wait" / "stop stop" / "no wait" / "hold on" / SW equivalents
  if (
    /^(no\s+|nope\s+|actually\s+)?(wait|stop|hold on|subiri|simama|acha|kusubiri)(\s+(wait|stop|hold on|subiri|simama|acha))*$/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Agent line looks like it asked a question / expects a short reply.
 * @param {string} agentText
 */
function agentAwaitingReply(agentText) {
  const t = String(agentText || '').toLowerCase();
  if (!t) return false;
  if (t.includes('?')) return true;
  return /\b(was that|did i hear|did you say|your name|may i (have|get)|spell|confirm|who (am i|is this) speaking)\b/.test(
    t
  );
}

/**
 * Strong enough speech to interrupt early TTS (not just noise).
 * @param {string} text
 */
function hasBargeContent(text) {
  const t = normalizeSpeech(text);
  if (!t) return false;
  if (INTERRUPT_CUES.test(t)) return true;
  const words = t.split(' ').filter(Boolean);
  if (words.some((w) => w.length >= 4)) return true;
  return words.length >= 2 && t.length >= 6;
}

/**
 * Adaptive local flush delay (ms) after final STT tokens.
 * Short answers after a question → faster; incomplete thoughts → longer.
 *
 * @param {{ text?: string, lastAgentText?: string, baseMs?: number, minMs?: number, maxMs?: number }} opts
 */
function adaptiveFlushMs(opts = {}) {
  const base = Number(
    opts.baseMs != null
      ? opts.baseMs
      : process.env.SONIOX_MAX_ENDPOINT_DELAY_MS || 700
  );
  const min = Number(opts.minMs != null ? opts.minMs : process.env.VOICE_FLUSH_MIN_MS || 300);
  const max = Number(opts.maxMs != null ? opts.maxMs : process.env.VOICE_FLUSH_MAX_MS || 1200);

  const text = String(opts.text || '').replace(/\s+/g, ' ').trim();
  const norm = normalizeSpeech(text);
  const words = norm.split(' ').filter(Boolean);
  const awaiting = agentAwaitingReply(opts.lastAgentText);

  if (utteranceLooksIncomplete(text)) {
    // Give the caller room to finish ("…and—" / "my name is—").
    return clamp(Math.max(base + 450, min + 200), min, max);
  }

  if (/[.!?]$/.test(text) && !utteranceLooksIncomplete(text)) {
    return clamp(Math.min(base, 480), min, max);
  }

  if (awaiting && (SHORT_CONFIRMS.has(norm) || words.length <= 3)) {
    return clamp(Math.min(base, 420), min, max);
  }

  if (words.length <= 2 && norm.length <= 14) {
    return clamp(Math.min(base, 520), min, max);
  }

  return clamp(base, min, max);
}

/**
 * Decide whether inbound speech should cancel TTS / in-flight LLM.
 *
 * @param {object} opts
 * @param {string} opts.text
 * @param {boolean} opts.speaking
 * @param {boolean} opts.turnBusy
 * @param {number} opts.speakStartedAt
 * @param {string} [opts.lastAgentText]
 * @param {(t: string) => boolean} opts.isBackchannel
 * @param {number} [opts.now]
 * @returns {{ barge: boolean, reason: string }}
 */
function evaluateBargeIn(opts) {
  const {
    text,
    speaking,
    turnBusy,
    speakStartedAt = 0,
    lastAgentText = '',
    isBackchannel,
    now = Date.now(),
  } = opts;

  const agentBusy = Boolean(speaking || turnBusy);
  if (!agentBusy) return { barge: false, reason: 'idle' };

  const clean = String(text || '').trim();
  if (clean.length <= 2) return { barge: false, reason: 'too_short' };
  if (typeof isBackchannel === 'function' && isBackchannel(clean)) {
    return { barge: false, reason: 'backchannel' };
  }

  if (speaking && looksLikeEcho(clean, lastAgentText)) {
    return { barge: false, reason: 'echo' };
  }

  const graceMs = Number(process.env.VOICE_BARGE_GRACE_MS || 200);
  const earlyMs = Number(process.env.VOICE_BARGE_EARLY_MS || 800);
  const minChars = Number(process.env.VOICE_BARGE_MIN_CHARS || 5);

  if (speaking) {
    const spokenForMs = Math.max(0, now - Number(speakStartedAt || 0));
    if (spokenForMs < graceMs) return { barge: false, reason: 'grace' };

    // Early in playback: demand clearer interrupt signal (cuts false barge from echo).
    if (spokenForMs < earlyMs) {
      if (clean.length < minChars) return { barge: false, reason: 'weak_interim' };
      if (!hasBargeContent(clean)) return { barge: false, reason: 'no_content' };
    }
    return { barge: true, reason: 'interrupt_tts' };
  }

  // LLM thinking / tool work with no audio yet — allow snappier cancel.
  if (clean.length < minChars && !INTERRUPT_CUES.test(clean)) {
    return { barge: false, reason: 'weak_thinking_interrupt' };
  }
  return { barge: true, reason: 'interrupt_llm' };
}

/**
 * Final STT while agent audio is still playing and barge did not fire.
 * Drop clear echoes; keep real overlap for the next caller turn.
 *
 * @param {string} callerText
 * @param {string} agentText
 * @returns {'drop_echo' | 'queue'}
 */
function classifyFinalDuringAgentSpeech(callerText, agentText) {
  if (looksLikeEcho(callerText, agentText)) return 'drop_echo';
  return 'queue';
}

module.exports = {
  normalizeSpeech,
  looksLikeEcho,
  utteranceLooksIncomplete,
  isInterruptOnlyUtterance,
  agentAwaitingReply,
  hasBargeContent,
  adaptiveFlushMs,
  evaluateBargeIn,
  classifyFinalDuringAgentSpeech,
};
