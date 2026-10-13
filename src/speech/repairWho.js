// VOICE_REPAIR_WHO: treat "who" / "nani" (and "hmm" while a question is open)
// as "say that again" before the file-name ask (HD_cc455b0ce145 / HD_f80ab5e17d83).
// off (default) keeps main HEAR_AGAIN_ONLY_RE unchanged.
//
// "hmm" alone with no open question stays a soft backchannel (existing
// turnTaking tests). Over or after a greeting/question it is hear-again.

const ON = new Set(['on', '1', 'true', 'yes']);

function repairWhoEnabled(env = process.env) {
  return ON.has(String(env.VOICE_REPAIR_WHO || 'off').trim().toLowerCase());
}

const REPAIR_WHO_ALWAYS_RE = /^(who|nani)$/i;
const REPAIR_HMM_RE = /^hmm+$/i;

function normalizeRepairToken(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\?+$/g, '')
    .trim();
}

/**
 * @param {string} text
 * @param {{ awaiting?: boolean }} [opts]
 */
function isRepairWhoUtterance(text, opts = {}) {
  if (!repairWhoEnabled()) return false;
  const t = normalizeRepairToken(text);
  if (!t) return false;
  if (REPAIR_WHO_ALWAYS_RE.test(t)) return true;
  if (REPAIR_HMM_RE.test(t) && opts.awaiting === true) return true;
  return false;
}

module.exports = {
  repairWhoEnabled,
  isRepairWhoUtterance,
  REPAIR_WHO_ALWAYS_RE,
  REPAIR_HMM_RE,
};
