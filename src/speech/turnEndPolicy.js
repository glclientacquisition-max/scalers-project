// One turn-end policy. Soniox endpoint, language tails, and a bounded wait.
//
// Latency budget (defaults; env may tighten the clamp, not the shape):
// - Soniox endpoint fires at SONIOX_MAX_ENDPOINT_DELAY_MS (700ms).
// - A finished sentence (.!?) may flush at min(endpoint, 480ms).
// - An unfinished turn (trailing comma, dash, or a language tail / auxiliary)
//   holds for endpoint + 450ms, clamped to VOICE_FLUSH_MIN_MS..VOICE_FLUSH_MAX_MS
//   (300..1200). The hold never exceeds the max.
// - A `finished` session flushes immediately. The max wait is the local cap
//   after an endpoint, not an unbounded listen.
// See docs/agents/VOICE_TURN_END.md.

const {
  incompleteTailPattern,
  incompletePhrasePattern,
  holdUtterancePatterns,
} = require('./languages');

const LATENCY_BUDGET = {
  sonioxEndpointMs: 700,
  incompleteExtraMs: 450,
  maxWaitMs: 1200,
  minWaitMs: 300,
  completeSentenceCapMs: 480,
  shortConfirmCapMs: 420,
};

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

/**
 * True when the caller is mid-thought. Trailing comma and dash hold the
 * same way. A finished sentence may contain an internal comma.
 * Tails and auxiliaries come from the language packs (all of them: callers
 * code-switch inside one turn).
 * @param {string} text
 */
function looksIncomplete(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  if (/[\u2014\u2013-]\s*$/.test(raw)) return true;
  if (/,\s*$/.test(raw)) return true;

  const core = raw.replace(/[.!?,;:…]+$/g, '').trim();
  if (!core) return false;
  if (incompleteTailPattern().test(core) || incompleteTailPattern().test(raw)) return true;
  if (incompletePhrasePattern().test(core)) return true;
  const norm = normalizeSpeech(core);
  for (const re of holdUtterancePatterns()) {
    if (re.test(norm)) return true;
  }
  return false;
}

function holdReason(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (/[\u2014\u2013-]\s*$/.test(raw)) return 'trailing_dash';
  if (/,\s*$/.test(raw)) return 'trailing_comma';
  const core = raw.replace(/[.!?,;:…]+$/g, '').trim();
  if (incompleteTailPattern().test(core) || incompleteTailPattern().test(raw)) return 'incomplete_tail';
  if (incompletePhrasePattern().test(core)) return 'incomplete_phrase';
  return 'incomplete_utterance';
}

function endpointBaseMs(opts = {}) {
  return Number(
    opts.baseMs != null ? opts.baseMs : process.env.SONIOX_MAX_ENDPOINT_DELAY_MS || LATENCY_BUDGET.sonioxEndpointMs
  );
}

function waitBounds(opts = {}) {
  const min = Number(opts.minMs != null ? opts.minMs : process.env.VOICE_FLUSH_MIN_MS || LATENCY_BUDGET.minWaitMs);
  const max = Number(opts.maxMs != null ? opts.maxMs : process.env.VOICE_FLUSH_MAX_MS || LATENCY_BUDGET.maxWaitMs);
  return { min, max };
}

/** Local flush delay for an unfinished turn. Never above the max wait. */
function incompleteWaitMs(opts = {}) {
  const base = endpointBaseMs(opts);
  const { min, max } = waitBounds(opts);
  return clamp(Math.max(base + LATENCY_BUDGET.incompleteExtraMs, min + 200), min, max);
}

/**
 * What to do when Soniox signals endpoint or finished.
 * @returns {{ action: 'flush'|'hold', waitMs: number, reason: string, incomplete: boolean, budget: object }}
 */
function decideTurnEnd(opts = {}) {
  const event = String(opts.event || 'endpoint');
  const text = String(opts.text || '');
  const incomplete = looksIncomplete(text);
  const budget = { ...LATENCY_BUDGET };
  if (event === 'finished') {
    return { action: 'flush', waitMs: 0, reason: 'session_finished', incomplete, budget };
  }
  if (event === 'endpoint' && incomplete) {
    const waitMs = opts.flushMs != null ? Number(opts.flushMs) : incompleteWaitMs(opts);
    return {
      action: 'hold',
      waitMs,
      reason: holdReason(text),
      incomplete: true,
      budget,
    };
  }
  return { action: 'flush', waitMs: 0, reason: 'complete', incomplete: false, budget };
}

module.exports = {
  LATENCY_BUDGET,
  looksIncomplete,
  holdReason,
  incompleteWaitMs,
  decideTurnEnd,
};
