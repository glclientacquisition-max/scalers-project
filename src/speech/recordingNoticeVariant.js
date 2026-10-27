'use strict';

// Recording notice A/B (VOICE_RECORDING_NOTICE_VARIANT), on top of
// VOICE_OPENING_V2. Greet and ask first, then a short reason-led notice in the
// same voice and language:
//
//   "Hapa ni Esga, naitwa Lucy. Nikusaidie vipi? Na kwa ubora wa huduma, tunarekodi simu."
//
// VOICE_RECORDING_NOTICE_VARIANT
//   off (default) - today's notice ("Simu hii inaweza kurekodiwa.") before the question
//   a | b | c     - every call hears that wording
//   a,b,c         - each call gets one of the listed wordings, picked from a
//                   hash of its callSid (deterministic, no randomness), so a
//                   reconnect of the same call keeps its variant
//
// The notice is spoken only while VOICE_STREAM_RECORD records the call, and
// to returning callers too unless VOICE_RETURNING_SKIP_NOTICE is on (same
// rules as the V2 opening). Cut by a barge, it is owed: said once, as a
// standalone line without the joining "Na " / "And ", before the first
// personal-details ask or save.

const FLAG = 'VOICE_RECORDING_NOTICE_VARIANT';
const VARIANTS = ['a', 'b', 'c'];
/** A hang-up this soon after the greeting ends counts as early. */
const EARLY_HANGUP_MS = 5000;

const WORDINGS = {
  sw: {
    a: 'Na kwa ubora wa huduma, tunarekodi simu.',
    b: 'Kwa ubora wa huduma, simu hii inarekodiwa.',
    c: 'Tunarekodi simu ili tukuhudumie vizuri zaidi.',
  },
  en: {
    a: 'And for service quality, we record calls.',
    b: 'For service quality, this call is recorded.',
    c: 'We record calls so we can serve you better.',
  },
};

/** Configured variants, in order; [] means off. Unknown letters are ignored. */
function noticeVariants(env = process.env) {
  const raw = String(env[FLAG] || '').trim().toLowerCase();
  if (!raw || /^(off|0|false|no|none)$/.test(raw)) return [];
  if (raw === 'all' || raw === 'on') return [...VARIANTS];
  const out = [];
  for (const part of raw.split(/[\s,|/]+/)) {
    if (VARIANTS.includes(part) && !out.includes(part)) out.push(part);
  }
  return out;
}

/** FNV-1a 32-bit; stable across processes and replicas. */
function fnv1a(text) {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The variant for this call, or null (off).
 * @param {string} callSid
 */
function pickNoticeVariant(callSid, env = process.env) {
  const list = noticeVariants(env);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  return list[fnv1a(callSid) % list.length];
}

/** The notice sentence for a variant in a language ('' when off). */
function noticeWording(variant, language) {
  const lang = language === 'sw' ? 'sw' : 'en';
  return (variant && WORDINGS[lang][variant]) || '';
}

/**
 * Did the caller hang up within EARLY_HANGUP_MS of the greeting end?
 * A close before the greeting ended counts as early. A close we started
 * (goodbye, silence end, transfer) never does.
 * @param {{ greetingEndAt?: number|null, closedAt: number, byAgent?: boolean }} o
 * @returns {{ early: boolean, sinceEndMs: number|null }}
 */
function earlyHangup({ greetingEndAt = null, closedAt, byAgent = false } = {}) {
  if (byAgent) return { early: false, sinceEndMs: greetingEndAt == null ? null : closedAt - greetingEndAt };
  if (greetingEndAt == null) return { early: true, sinceEndMs: null };
  const since = closedAt - greetingEndAt;
  return { early: since <= EARLY_HANGUP_MS, sinceEndMs: since };
}

module.exports = {
  FLAG,
  VARIANTS,
  WORDINGS,
  EARLY_HANGUP_MS,
  noticeVariants,
  pickNoticeVariant,
  noticeWording,
  earlyHangup,
  fnv1a,
};
