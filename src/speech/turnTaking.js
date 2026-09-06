// Turn-taking helpers: adaptive end-of-utterance flush + barge-in decisions.
// Caller-event policy lives in decideCallerEvent — one table, one outcome.

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

const NO_TOKENS = new Set(['no', 'nope', 'hapana']);
const CONFIRM_TOKENS = new Set([
  'yes',
  'yeah',
  'yep',
  'yup',
  'ndiyo',
  'ndio',
  'sawa',
  'okay',
  'ok',
  'sure',
  'correct',
  'right',
  'exactly',
]);

const SOFT_BACKCHANNELS = new Set([
  'ok',
  'okay',
  'oke',
  'sawa',
  'yeah',
  'yep',
  'yup',
  'mm',
  'mmm',
  'mhm',
  'uh huh',
  'uh-huh',
  'uh yeah',
  'um yeah',
  'aha',
  'ah',
  'oh',
  'hmm',
  'right',
  'sure',
  'true',
  'hello',
  'hello?',
  'hi',
  'hey',
  'yeah?',
  'ndiyo',
  'eh',
  'eeh',
  'poa',
  'gemini',
]);

const WAIT_STOP_RE =
  /^(?:(?:no|nope|actually)\s+)?(?:please\s+)?(?:wait|stop|hold(?:\s+on)?|subiri|simama|acha|kusubiri)(?:\s+(?:wait|stop|hold(?:\s+on)?|subiri|simama|acha))*(?:\s+(?:a\s+)?(?:second|minute|moment|kidogo))?(?:\s+please)?$/i;

const LET_ME_THINK_RE =
  /^(?:(?:please\s+)?(?:let me think|let me see|i need to think|i'?m thinking)(?:\s+about(?:\s+it)?)?|hold that thought)$/i;

const HEAR_AGAIN_ONLY_RE =
  /^(pardon(?:\s+me)?|sorry|what|huh|eh|come again|say(?:\s+that)?\s+again|repeat(?:\s+that)?|nini|sema tena)$/i;

const NAMED_EARLY_CUES =
  /^(wait|stop|hold(?:\s+on)?|no|nope|actually|sorry|pardon|subiri|simama|acha|hapana|i said)\b/i;

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
  // Mid-thought cutoffs common on live Kenyan calls (HD_02bda14e6547).
  if (
    /\b(i want to|i'd like to|i would like to|ningetaka|naomba|can you tell|you can tell)\s*$/i.test(
      core
    )
  ) {
    return true;
  }
  if (/\b(that i'm|that i am|tell him that|tell her that)\s*$/i.test(core)) {
    return true;
  }
  const norm = normalizeSpeech(core);
  if (LET_ME_THINK_RE.test(norm)) return true;
  if (/\b(let me think|i('m| am) thinking)\s*$/i.test(core)) return true;
  if (/^(actually|i said)$/i.test(norm)) return true;
  if (/\b(actually|i said)\s*$/i.test(core)) return true;
  return false;
}

/**
 * Pure barge / yield cues with no new request — after cancel, just listen.
 * @param {string} text
 */
function isInterruptOnlyUtterance(text) {
  const t = normalizeSpeech(text);
  if (!t) return false;
  return WAIT_STOP_RE.test(t);
}

function isLetMeThinkUtterance(text) {
  return LET_ME_THINK_RE.test(normalizeSpeech(text));
}

function isHearAgainUtterance(text) {
  const t = normalizeSpeech(text);
  if (!t) return false;
  if (HEAR_AGAIN_ONLY_RE.test(t)) return true;
  if (/^(sorry|pardon)\b/.test(t) && /\b(what|huh|again|say|repeat|didn'?t hear|did not hear)\b/.test(t)) {
    return true;
  }
  return false;
}

function isYesUtterance(text) {
  const t = normalizeSpeech(text);
  return /^(yes|yeah|yep|yup|ndiyo|ndio)(?:\s+please)?$/.test(t);
}

function isBareNoUtterance(text) {
  const t = normalizeSpeech(text);
  return /^(no|nope|hapana)$/.test(t);
}

function isNoCorrectionUtterance(text) {
  const t = normalizeSpeech(text);
  if (!/^(no|nope|hapana)\b/.test(t)) return false;
  if (WAIT_STOP_RE.test(t)) return false;
  return /\b(actually|that'?s not|not what|i said|i meant|wrong)\b/.test(t);
}

function isActuallyUtterance(text) {
  const t = normalizeSpeech(text);
  return /^actually\b/.test(t) && !WAIT_STOP_RE.test(t) && !isNoCorrectionUtterance(t);
}

function isISaidUtterance(text) {
  const t = normalizeSpeech(text);
  return /^i said\b/.test(t);
}

/**
 * Agent line looks like it asked a question / expects a short reply.
 * @param {string} agentText
 */
function agentAwaitingReply(agentText) {
  const t = String(agentText || '').toLowerCase();
  if (!t) return false;
  if (t.includes('?')) return true;
  return /\b(was that|did i hear|did you say|your name|may i (have|get)|spell|confirm|who (am i|is this) speaking|would you like|could you|shall i)\b/.test(
    t
  );
}

function resolveAwaiting(opts = {}) {
  if (opts.lastAgentAskedQuestion === true) return true;
  if (opts.lastAgentAskedQuestion === false) return false;
  return agentAwaitingReply(opts.lastAgentText);
}

function resolvePhase(opts = {}) {
  if (opts.phase === 'speaking' || opts.phase === 'thinking' || opts.phase === 'idle') {
    return opts.phase;
  }
  if (opts.speaking) return 'speaking';
  if (opts.turnBusy) return 'thinking';
  return 'idle';
}

/**
 * Strong enough speech to interrupt early TTS (not just noise).
 * "Let me think" is not barge content merely because "think" is four letters.
 * @param {string} text
 */
function hasBargeContent(text) {
  const t = normalizeSpeech(text);
  if (!t) return false;
  if (isLetMeThinkUtterance(t)) return false;
  if (INTERRUPT_CUES.test(t)) return true;
  const words = t.split(' ').filter(Boolean);
  if (words.some((w) => w.length >= 4)) return true;
  return words.length >= 2 && t.length >= 6;
}

function isNamedEarlyCue(text) {
  const t = normalizeSpeech(text);
  if (!t) return false;
  if (WAIT_STOP_RE.test(t)) return true;
  if (isHearAgainUtterance(t)) return true;
  if (isActuallyUtterance(t) || isISaidUtterance(t) || isNoCorrectionUtterance(t)) return true;
  return NAMED_EARLY_CUES.test(t);
}

/**
 * Kind of caller text, independent of phase.
 * @param {string} text
 * @param {{ lastAgentText?: string, lastAgentAskedQuestion?: boolean }} [opts]
 * @returns {string}
 */
function classifyCallerUtteranceKind(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!raw) return 'empty';
  const t = normalizeSpeech(raw);
  if (!t) return 'empty';

  const awaiting = resolveAwaiting(opts);

  if (WAIT_STOP_RE.test(t)) return 'wait_stop';
  if (isHearAgainUtterance(t)) return 'hear_again';
  if (isLetMeThinkUtterance(t)) return 'let_me_think';
  if (isNoCorrectionUtterance(t)) return 'no_correction';
  if (isISaidUtterance(t)) {
    return /^i said$/.test(t) ? 'i_said_incomplete' : 'i_said';
  }
  if (isActuallyUtterance(t)) {
    return /^actually$/.test(t) ? 'actually_incomplete' : 'actually';
  }
  if (looksLikeEcho(raw, opts.lastAgentText)) return 'echo';
  if (isYesUtterance(t)) {
    if (awaiting) return 'yes';
    return /\bplease$/.test(t) ? 'speech' : 'backchannel';
  }
  if (awaiting && CONFIRM_TOKENS.has(t) && !NO_TOKENS.has(t)) return 'yes';
  if (isBareNoUtterance(t)) return awaiting ? 'no' : 'no_unprompted';
  if (SOFT_BACKCHANNELS.has(t) || SOFT_BACKCHANNELS.has(raw.toLowerCase())) return 'backchannel';
  if (utteranceLooksIncomplete(raw) && /^(and|but|so|or|na)$/i.test(t)) return 'incomplete';
  if (t.length <= 2 && !NO_TOKENS.has(t)) return 'noise';
  return 'speech';
}

function outcome(partial) {
  const action = partial.action;
  const runGemini = partial.runGemini === true;
  const skip =
    partial.skip === true ||
    action === 'skip' ||
    action === 'ignore' ||
    action === 'barge_listen';
  return {
    action,
    reason: partial.reason,
    stopTts: partial.stopTts === true,
    interrupt: partial.interrupt === true,
    runGemini,
    queue: partial.queue === true,
    skip: skip && !runGemini,
    replay: partial.replay === true,
    kind: partial.kind || '',
    phase: partial.phase || '',
  };
}

/**
 * Authoritative caller-event policy.
 * STT / barge / skip must follow this table rather than overlapping predicates.
 *
 * @param {object} opts
 * @param {string} [opts.text]
 * @param {boolean} [opts.speaking]
 * @param {boolean} [opts.turnBusy]
 * @param {string} [opts.lastAgentText]
 * @param {boolean} [opts.lastAgentAskedQuestion]
 * @param {'speaking'|'thinking'|'idle'} [opts.phase]
 * @param {number} [opts.speakStartedAt]
 * @param {number} [opts.now]
 * @returns {{
 *   action: 'ignore'|'barge_listen'|'barge_gemini'|'queue'|'process_turn'|'skip',
 *   reason: string,
 *   stopTts: boolean,
 *   interrupt: boolean,
 *   runGemini: boolean,
 *   queue: boolean,
 *   skip: boolean,
 *   replay: boolean,
 *   kind: string,
 *   phase: string
 * }}
 */
function decideCallerEvent(opts = {}) {
  const text = String(opts.text || '').trim();
  const phase = resolvePhase(opts);
  const lastAgentText = opts.lastAgentText || '';
  const awaiting = resolveAwaiting(opts);
  const kind = classifyCallerUtteranceKind(text, {
    lastAgentText,
    lastAgentAskedQuestion: awaiting,
  });
  const now = opts.now != null ? Number(opts.now) : Date.now();
  const graceMs = Number(process.env.VOICE_BARGE_GRACE_MS || 200);
  const earlyMs = Number(process.env.VOICE_BARGE_EARLY_MS || 800);
  const minChars = Number(process.env.VOICE_BARGE_MIN_CHARS || 5);
  const spokenForMs =
    phase === 'speaking' ? Math.max(0, now - Number(opts.speakStartedAt || 0)) : 0;

  const base = { kind, phase };

  if (kind === 'empty') {
    return outcome({ ...base, action: 'ignore', reason: 'empty' });
  }

  if (phase === 'speaking' && kind === 'echo') {
    return outcome({ ...base, action: 'ignore', reason: 'echo' });
  }

  if (phase === 'speaking' && spokenForMs < graceMs) {
    return outcome({ ...base, action: 'ignore', reason: 'grace' });
  }

  if (kind === 'wait_stop') {
    if (phase === 'speaking') {
      return outcome({
        ...base,
        action: 'barge_listen',
        reason: 'interrupt_wait',
        stopTts: true,
        interrupt: true,
      });
    }
    if (phase === 'thinking') {
      return outcome({
        ...base,
        action: 'barge_listen',
        reason: 'interrupt_wait',
        interrupt: true,
      });
    }
    return outcome({ ...base, action: 'skip', reason: 'interrupt_wait', skip: true });
  }

  if (kind === 'hear_again') {
    const replay = Boolean(
      String(opts.replayText || lastAgentText || '').trim()
    );
    if (phase === 'speaking') {
      return outcome({
        ...base,
        action: 'barge_listen',
        reason: 'hear_again',
        stopTts: true,
        interrupt: true,
        replay,
      });
    }
    if (phase === 'thinking') {
      return outcome({
        ...base,
        action: 'barge_listen',
        reason: 'hear_again',
        interrupt: true,
        replay,
      });
    }
    return outcome({
      ...base,
      action: 'skip',
      reason: 'hear_again',
      skip: true,
      replay,
    });
  }

  if (kind === 'yes') {
    if (phase === 'speaking') {
      return outcome({
        ...base,
        action: 'queue',
        reason: 'answer_yes',
        queue: true,
        runGemini: true,
      });
    }
    if (phase === 'thinking') {
      return outcome({
        ...base,
        action: 'queue',
        reason: 'answer_yes',
        queue: true,
        runGemini: true,
      });
    }
    return outcome({
      ...base,
      action: 'process_turn',
      reason: 'answer_yes',
      runGemini: true,
    });
  }

  if (kind === 'no') {
    if (phase === 'speaking') {
      return outcome({
        ...base,
        action: 'queue',
        reason: 'answer_no',
        queue: true,
        runGemini: true,
      });
    }
    if (phase === 'thinking') {
      return outcome({
        ...base,
        action: 'queue',
        reason: 'answer_no',
        queue: true,
        runGemini: true,
      });
    }
    return outcome({
      ...base,
      action: 'process_turn',
      reason: 'answer_no',
      runGemini: true,
    });
  }

  if (kind === 'no_unprompted') {
    return outcome({
      ...base,
      action: phase === 'idle' ? 'skip' : 'ignore',
      reason: phase === 'thinking' ? 'thinking_continuation' : 'backchannel',
      skip: true,
    });
  }

  if (kind === 'no_correction') {
    if (phase === 'speaking') {
      return outcome({
        ...base,
        action: 'barge_gemini',
        reason: 'interrupt_correction',
        stopTts: true,
        interrupt: true,
        runGemini: true,
      });
    }
    if (phase === 'thinking') {
      return outcome({
        ...base,
        action: 'barge_gemini',
        reason: 'interrupt_correction',
        interrupt: true,
        runGemini: true,
      });
    }
    return outcome({
      ...base,
      action: 'process_turn',
      reason: 'interrupt_correction',
      runGemini: true,
    });
  }

  if (kind === 'actually_incomplete' || kind === 'i_said_incomplete') {
    if (phase === 'speaking') {
      return outcome({
        ...base,
        action: 'barge_listen',
        reason: 'incomplete_correction',
        stopTts: true,
        interrupt: true,
      });
    }
    if (phase === 'thinking') {
      return outcome({
        ...base,
        action: 'barge_listen',
        reason: 'incomplete_correction',
        interrupt: true,
      });
    }
    return outcome({
      ...base,
      action: 'skip',
      reason: 'incomplete_correction',
      skip: true,
      queue: true,
    });
  }

  if (kind === 'actually' || kind === 'i_said') {
    if (phase === 'speaking') {
      return outcome({
        ...base,
        action: 'barge_gemini',
        reason: 'interrupt_correction',
        stopTts: true,
        interrupt: true,
        runGemini: true,
      });
    }
    if (phase === 'thinking') {
      return outcome({
        ...base,
        action: 'barge_gemini',
        reason: 'interrupt_correction',
        interrupt: true,
        runGemini: true,
      });
    }
    return outcome({
      ...base,
      action: 'process_turn',
      reason: 'interrupt_correction',
      runGemini: true,
    });
  }

  if (kind === 'let_me_think') {
    if (phase === 'speaking') {
      return outcome({ ...base, action: 'ignore', reason: 'incomplete' });
    }
    if (phase === 'thinking') {
      return outcome({ ...base, action: 'ignore', reason: 'thinking_continuation' });
    }
    return outcome({
      ...base,
      action: 'skip',
      reason: 'incomplete',
      skip: true,
      queue: true,
    });
  }

  if (kind === 'backchannel') {
    return outcome({ ...base, action: 'ignore', reason: 'backchannel', skip: true });
  }

  if (kind === 'incomplete') {
    if (phase === 'speaking') {
      return outcome({ ...base, action: 'ignore', reason: 'incomplete' });
    }
    if (phase === 'thinking') {
      return outcome({ ...base, action: 'ignore', reason: 'thinking_continuation' });
    }
    return outcome({
      ...base,
      action: 'skip',
      reason: 'incomplete',
      skip: true,
      queue: true,
    });
  }

  if (kind === 'noise') {
    return outcome({ ...base, action: 'ignore', reason: 'too_short', skip: true });
  }

  // Ordinary speech. Preserve grace (already applied) + early-window min-char
  // unless the utterance is a named interrupt cue.
  if (phase === 'speaking') {
    if (spokenForMs < earlyMs) {
      const cue = isNamedEarlyCue(text);
      if (!cue && text.length < minChars) {
        return outcome({ ...base, action: 'ignore', reason: 'weak_interim' });
      }
      if (!cue && !hasBargeContent(text)) {
        return outcome({ ...base, action: 'ignore', reason: 'no_content' });
      }
    }
    return outcome({
      ...base,
      action: 'barge_gemini',
      reason: 'interrupt_tts',
      stopTts: true,
      interrupt: true,
      runGemini: true,
    });
  }

  if (phase === 'thinking') {
    if (!INTERRUPT_CUES.test(text) && !isNamedEarlyCue(text)) {
      return outcome({ ...base, action: 'ignore', reason: 'thinking_continuation' });
    }
    if (!isNamedEarlyCue(text) && text.length < minChars) {
      return outcome({ ...base, action: 'ignore', reason: 'weak_thinking_interrupt' });
    }
    return outcome({
      ...base,
      action: 'barge_gemini',
      reason: 'interrupt_llm',
      interrupt: true,
      runGemini: true,
    });
  }

  // Idle: short names and ordinary requests reach Gemini.
  if (awaiting && text.length <= 40) {
    const words = normalizeSpeech(text).split(' ').filter(Boolean);
    if (words.length >= 1 && words.length <= 3 && !SOFT_BACKCHANNELS.has(words.join(' '))) {
      return outcome({
        ...base,
        action: 'process_turn',
        reason: 'ordinary_speech',
        runGemini: true,
      });
    }
  }

  return outcome({
    ...base,
    action: 'process_turn',
    reason: 'ordinary_speech',
    runGemini: true,
  });
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
 * Thin wrapper over decideCallerEvent so existing barge callers stay valid.
 *
 * @param {object} opts
 * @returns {{ barge: boolean, reason: string }}
 */
function evaluateBargeIn(opts = {}) {
  const speaking = Boolean(opts.speaking);
  const turnBusy = Boolean(opts.turnBusy);
  if (!speaking && !turnBusy) return { barge: false, reason: 'idle' };

  const decision = decideCallerEvent(opts);
  return { barge: decision.interrupt, reason: decision.reason };
}

/**
 * Final STT while agent audio is still playing and barge did not fire.
 * Drop clear echoes; keep real overlap for the next caller turn.
 *
 * @param {string} callerText
 * @param {string} agentText
 * @returns {'drop_echo' | 'queue'}
 */
function classifyFinalDuringAgentSpeech(callerText, agentText, opts = {}) {
  const decision = decideCallerEvent({
    text: callerText,
    speaking: true,
    turnBusy: opts.turnBusy,
    lastAgentText: agentText,
    lastAgentAskedQuestion: opts.lastAgentAskedQuestion,
    speakStartedAt: opts.speakStartedAt != null ? opts.speakStartedAt : Date.now() - 2000,
    now: opts.now || Date.now(),
    isFinal: true,
    phase: 'speaking',
  });
  if (decision.reason === 'echo' || looksLikeEcho(callerText, agentText)) return 'drop_echo';
  if (decision.queue || decision.runGemini || decision.action === 'queue' || decision.action === 'barge_gemini') {
    return 'queue';
  }
  if (decision.action === 'barge_listen' || decision.action === 'skip' || decision.action === 'ignore') {
    return 'drop_echo';
  }
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
  classifyCallerUtteranceKind,
  decideCallerEvent,
};
