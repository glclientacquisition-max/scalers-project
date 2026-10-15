// VOICE_OWED_CONFIRM_FOLD: fold a barged booking/callback confirmation into the
// next reply as one receipt line, and block duplicate create_service_request
// on the same call. off (default) keeps the #617 prefix-speak path byte-identical.

const ON = new Set(['on', '1', 'true', 'yes']);

function owedConfirmFoldEnabled(env = process.env) {
  return ON.has(String(env.VOICE_OWED_CONFIRM_FOLD || 'off').trim().toLowerCase());
}

const SAVED_CLAIM_RE =
  /\b(?:i(?:['’]?ve| have)\s+saved|nimehifadhi|nimechukua|request\s+(?:is\s+)?saved|ombi\s+lako)\b/i;

/**
 * Merge an owed tool receipt into the reply lines for this turn.
 * Returns one speakable list; the receipt is first when present.
 * @param {string} owed
 * @param {string[]} replyLines
 * @returns {{ lines: string[], folded: boolean, receipt: string }}
 */
function foldOwedIntoReply(owed, replyLines = []) {
  const receipt = String(owed || '')
    .replace(/\s+/g, ' ')
    .trim();
  const lines = (Array.isArray(replyLines) ? replyLines : [])
    .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!receipt) return { lines, folded: false, receipt: '' };

  const withoutClaim = lines.filter((line) => !SAVED_CLAIM_RE.test(line));
  // One receipt line, then the rest of the reply without a second saved claim.
  return { lines: [receipt, ...withoutClaim], folded: true, receipt };
}

/**
 * Strip model saved-claim sentences when a receipt already covers this turn.
 * @param {string} text
 */
function stripSavedClaimAfterReceipt(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const parts = raw
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return SAVED_CLAIM_RE.test(raw) ? '' : raw;
  }
  return parts.filter((part) => !SAVED_CLAIM_RE.test(part)).join(' ').trim();
}

module.exports = {
  owedConfirmFoldEnabled,
  foldOwedIntoReply,
  stripSavedClaimAfterReceipt,
  SAVED_CLAIM_RE,
};
