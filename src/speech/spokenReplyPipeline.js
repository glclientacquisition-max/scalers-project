// One spoken-reply pipeline. Each stage returns text plus a drop record.
// A stage may strip a clearly matched pattern. If it would remove more than
// a small fraction of a sentence, and that sentence is real answer content
// (a list, or anything that is not a clear pattern), the sentence stays.
// Silence after a caller turn is not decided here. planEmptyGeminiSpeech speaks.

const { stripSpokenInstructionLeaks } = require('./spokenInstructionLeak');
const { cutNoAiSlop } = require('./noAiSlop');
const { isOrphanFragment } = require('./outboundPcm');
const { prepareStreamedSpeech } = require('../conversation/callCorrectives');
const {
  guardSpokenReply,
  dropSpeechSlop,
  narratesInternalAction,
  sentenceGuardDropIsClear,
  sentenceIsSpeechSlop,
} = require('../conversation/speechGuard');
const {
  looksLikeOfferAsk,
  presupposesSavedWork,
  sanitizeSpokenFileClaim,
} = require('../conversation/fileRead');
const {
  looksLikeSpokenServiceDump,
  stripPrematureOutcomeClaims,
  stripSpokenHedges,
} = require('../conversation/dynamicSpeech');

const MAX_DROP_FRACTION = 0.35;

const PREPARE_CLEAR =
  /\b(?:ASR_?[A-Z_]*|RETOTI|NP_TRUE|NP_FALSE|I hear you loud and clear|(?:we )?look forward to serving you|have a (?:great|good|nice) day|thank you for choosing|got it,?\s+\d+|i will submit this (?:request|order)|all noted)\b/i;

const HEDGE_CLEAR =
  /^(okay[,.]?\s+|alright[,.]?\s+|sawa[,.]?\s+)?(one moment|just a (sec|second|minute)|hold on|let me (check|see|look|save that)|take your time|nakucheckia|kidogo|i('m| am) on it)( please)?\b/i;

const PREMATURE_CLEAR =
  /\b(i('ve| have) booked( you)?|your visit is booked|booking (is )?confirmed|i('ve| have) transferred you|stay on the line)\b/i;

function contentLen(text) {
  return String(text || '').replace(/\s/g, '').length;
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function preview(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
    .replace(/\d{6,}/g, '######');
}

function callerTextOf(ctx) {
  return String((ctx.callerTurns || ctx.state?.conversation?.answersReceived || []).slice(-1)[0] || '');
}

function tokenSet(text) {
  return new Set(norm(text).split(' ').filter(Boolean));
}

function survivingForm(sentence, afterSentences) {
  const n = norm(sentence);
  const nLen = Math.max(contentLen(sentence), 1);
  const nTokens = tokenSet(sentence);
  for (const part of afterSentences) {
    const p = norm(part);
    if (!p) continue;
    const frac = contentLen(part) / nLen;
    if (p === n) return part;
    if ((n.includes(p) || p.includes(n)) && frac >= 1 - MAX_DROP_FRACTION) return part;
    // A spelling fix ("Areyou" → "Are you") keeps the length and most words.
    // A canned replacement of a different sentence does not.
    if (
      nTokens.size &&
      frac >= 1 - MAX_DROP_FRACTION &&
      frac <= 1 + MAX_DROP_FRACTION
    ) {
      const pTokens = tokenSet(part);
      let overlap = 0;
      for (const token of nTokens) {
        if (pTokens.has(token)) overlap += 1;
      }
      if (overlap / nTokens.size >= 0.75) return part;
    }
  }
  return null;
}

/**
 * Keep sentences a stage removed unless the removal is a clear pattern
 * or only a small fraction of the sentence.
 */
function protectSentences(before, after, clearSentence) {
  const beforeSentences = splitSentences(before);
  if (!beforeSentences.length) {
    return { text: String(after || '').trim(), restored: [] };
  }
  const afterSentences = splitSentences(after);
  const pieces = [];
  const restored = [];
  for (const sentence of beforeSentences) {
    const kept = survivingForm(sentence, afterSentences);
    if (kept) {
      pieces.push(kept);
      continue;
    }
    if (clearSentence(sentence)) continue;
    restored.push(sentence);
    pieces.push(sentence);
  }
  if (!pieces.length) return { text: String(after || '').trim(), restored };
  // A stage may append a line that was not in the original (message-only
  // callback). Keep it when nothing was restored. A restored answer must
  // not also pick up a canned replacement of that answer.
  if (!restored.length) {
    for (const part of afterSentences) {
      const already = pieces.some((piece) => {
        const left = norm(piece);
        const right = norm(part);
        return left === right || left.includes(right) || right.includes(left);
      });
      if (!already) pieces.push(part);
    }
  }
  return { text: pieces.join(' ').replace(/\s+/g, ' ').trim(), restored };
}

function record(stage, reason, before, after, extra = {}) {
  return {
    stage,
    reason,
    kept: Boolean(extra.kept),
    before: contentLen(before),
    after: contentLen(after),
    preview: extra.preview != null ? extra.preview : preview(before),
  };
}

function stagePrepare(text) {
  const prepared = stripSpokenInstructionLeaks(prepareStreamedSpeech(text), { final: true });
  const guarded = protectSentences(text, prepared, (sentence) => PREPARE_CLEAR.test(sentence));
  if (guarded.text === String(text || '').replace(/\s+/g, ' ').trim() && !guarded.restored.length && prepared === text) {
    return { text: prepared, drops: [] };
  }
  if (norm(guarded.text) === norm(text) && contentLen(guarded.text) === contentLen(text)) {
    return { text: guarded.text || prepared, drops: [] };
  }
  const dropped = norm(prepared) !== norm(text);
  if (!dropped && !guarded.restored.length) return { text: prepared, drops: [] };
  return {
    text: guarded.text,
    drops: [
      record(
        'prepare',
        guarded.restored.length ? 'kept_answer' : 'instruction_or_unsaved_close',
        text,
        guarded.text,
        { kept: guarded.restored.length > 0, preview: preview(guarded.restored.join(' ') || text) }
      ),
    ],
  };
}

function stageGuard(text, ctx) {
  if (!ctx.state && !ctx.profile) return { text, drops: [] };
  const after = guardSpokenReply(text, {
    callerTurns: ctx.callerTurns || ctx.state?.conversation?.answersReceived || [],
    profile: ctx.profile || {},
    toolResults: ctx.toolResults || [],
    capabilities: ctx.capabilities || {},
    extra: JSON.stringify(ctx.state?.entities || {}),
    state: ctx.state,
    language: ctx.language,
    allowEmpty: true,
  });
  const guarded = protectSentences(text, after, (sentence) => sentenceGuardDropIsClear(sentence, {
    callerTurns: ctx.callerTurns || [],
    profile: ctx.profile || {},
    toolResults: ctx.toolResults || [],
    capabilities: ctx.capabilities || {},
    state: ctx.state,
    language: ctx.language,
    extra: JSON.stringify(ctx.state?.entities || {}),
  }));
  if (norm(guarded.text) === norm(text)) return { text: guarded.text, drops: [] };
  return {
    text: guarded.text,
    drops: [
      record('speech_guard', guarded.restored.length ? 'kept_answer' : 'clear_pattern', text, guarded.text, {
        kept: guarded.restored.length > 0,
        preview: preview(guarded.restored.join(' ') || text),
      }),
    ],
  };
}

function stageHedges(text, ctx) {
  const after = stripSpokenHedges(text, ctx);
  const guarded = protectSentences(text, after, (sentence) => HEDGE_CLEAR.test(sentence));
  if (norm(guarded.text) === norm(text)) return { text: guarded.text || after, drops: [] };
  return {
    text: guarded.text,
    drops: [record('hedges', guarded.restored.length ? 'kept_answer' : 'hedge', text, guarded.text, { kept: guarded.restored.length > 0 })],
  };
}

function stagePremature(text, ctx) {
  const after = stripPrematureOutcomeClaims(text, ctx);
  const guarded = protectSentences(text, after, (sentence) => PREMATURE_CLEAR.test(sentence));
  if (norm(guarded.text) === norm(text)) return { text: guarded.text || after, drops: [] };
  return {
    text: guarded.text,
    drops: [
      record('premature_outcome', guarded.restored.length ? 'kept_answer' : 'outcome_claim', text, guarded.text, {
        kept: guarded.restored.length > 0,
      }),
    ],
  };
}

function stageServiceDump(text, ctx) {
  const caller = callerTextOf(ctx);
  if (!looksLikeSpokenServiceDump(text) || looksLikeOfferAsk(caller)) return { text, drops: [] };
  return {
    text,
    drops: [record('service_dump', 'kept_answer_list', text, text, { kept: true, preview: preview(text) })],
  };
}

function stageFileClaim(text, ctx) {
  const caller = callerTextOf(ctx);
  const after = sanitizeSpokenFileClaim(text, {
    callerText: caller,
    state: ctx.state,
    language: ctx.language,
  });
  const guarded = protectSentences(text, after, (sentence) => presupposesSavedWork(sentence));
  if (norm(guarded.text) === norm(text)) return { text: guarded.text || after, drops: [] };
  return {
    text: guarded.text,
    drops: [
      record('file_claim', guarded.restored.length ? 'kept_answer' : 'invented_file', text, guarded.text, {
        kept: guarded.restored.length > 0,
      }),
    ],
  };
}

function stageSlop(text, ctx) {
  const caller = callerTextOf(ctx);
  const after = dropSpeechSlop(text, caller);
  const guarded = protectSentences(text, after, (sentence) => sentenceIsSpeechSlop(sentence, caller));
  if (norm(guarded.text) === norm(text)) return { text: guarded.text || after, drops: [] };
  return {
    text: guarded.text,
    drops: [record('speech_slop', guarded.restored.length ? 'kept_answer' : 'filler', text, guarded.text, { kept: guarded.restored.length > 0 })],
  };
}

function stageNoAiSlop(text) {
  const after = cutNoAiSlop(text);
  const guarded = protectSentences(text, after, (sentence) => !cutNoAiSlop(sentence));
  if (norm(guarded.text) === norm(text)) return { text: guarded.text || after, drops: [] };
  return {
    text: guarded.text,
    drops: [record('no_ai_slop', guarded.restored.length ? 'kept_answer' : 'slop_phrase', text, guarded.text, { kept: guarded.restored.length > 0 })],
  };
}

function stageOrphan(text, ctx) {
  if (!ctx.orphanOf || !isOrphanFragment(ctx.orphanOf, text)) return { text, drops: [] };
  return {
    text: '',
    drops: [record('orphan_fragment', 'barge_restart', text, '', { kept: false })],
  };
}

const STAGES = [
  stagePrepare,
  stageGuard,
  stageHedges,
  stagePremature,
  stageServiceDump,
  stageFileClaim,
  stageSlop,
  stageNoAiSlop,
  stageOrphan,
];

/**
 * @param {string} text
 * @param {object} [ctx]
 * @returns {{ text: string, drops: object[], hidNarration: boolean, orphan: boolean }}
 */
function runSpokenReplyPipeline(text, ctx = {}) {
  let current = String(text || '');
  const drops = [];
  let orphan = false;
  for (const stage of STAGES) {
    const before = current;
    const result = stage(before, ctx);
    current = result.text == null ? before : result.text;
    if (result.drops && result.drops.length) drops.push(...result.drops);
    if (stage === stageOrphan && result.drops && result.drops.length) orphan = true;
  }
  current = String(current || '').replace(/\s+/g, ' ').trim();
  const hidNarration = !current && !orphan && narratesInternalAction(text);
  if (typeof ctx.log === 'function') {
    for (const drop of drops) ctx.log(drop);
  }
  return { text: current, drops, hidNarration, orphan };
}

module.exports = {
  MAX_DROP_FRACTION,
  runSpokenReplyPipeline,
  protectSentences,
  splitSentences,
};
