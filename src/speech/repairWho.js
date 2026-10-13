// VOICE_REPAIR_WHO: treat "who" / "hmm" / "nani" as "say that again" before the
// file-name ask (HD_cc455b0ce145 / HD_f80ab5e17d83). off (default) keeps main
// HEAR_AGAIN_ONLY_RE unchanged.

const ON = new Set(['on', '1', 'true', 'yes']);

function repairWhoEnabled(env = process.env) {
  return ON.has(String(env.VOICE_REPAIR_WHO || 'off').trim().toLowerCase());
}

/** Exact short repair tokens added when the flag is on. */
const REPAIR_WHO_RE = /^(who|hmm+|nani)$/i;

function isRepairWhoUtterance(text) {
  if (!repairWhoEnabled()) return false;
  const t = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\?+$/g, '')
    .trim();
  return REPAIR_WHO_RE.test(t);
}

module.exports = {
  repairWhoEnabled,
  isRepairWhoUtterance,
  REPAIR_WHO_RE,
};
