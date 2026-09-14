/**
 * Same owner sentence Calls uses on the call page.
 * Hangup review first, then live reason. Contacts last reason uses this too.
 *
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {string | null}
 */
function pickCallOwnerReason(meta) {
  if (!meta || typeof meta !== "object") return null;
  const review =
    meta.owner_review &&
    typeof meta.owner_review === "object" &&
    !Array.isArray(meta.owner_review)
      ? meta.owner_review
      : null;
  const fromReview =
    review && typeof review.reason === "string"
      ? review.reason.replace(/\s+/g, " ").trim()
      : "";
  if (fromReview) return fromReview;
  const fromReason =
    typeof meta.reason === "string" ? meta.reason.replace(/\s+/g, " ").trim() : "";
  return fromReason || null;
}

/**
 * @param {{
 *   name: string | null,
 *   reason: string | null,
 *   callerNumber: string,
 *   urgent?: boolean,
 * }} opts
 */
function buildSummarySentence(opts) {
  const who = opts.name || `The caller (${opts.callerNumber})`;
  const extra = opts.urgent ? " This sounded urgent." : "";
  if (!opts.reason) {
    return `${who} called.${extra}`;
  }
  const reason = opts.reason.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  const named =
    /^(caller|the caller)\b/i.test(reason) ||
    Boolean(opts.name && reason.toLowerCase().startsWith(opts.name.toLowerCase()));
  const complete =
    reason.length >= 40 ||
    /\b(left a hold|booked a visit|updated a visit|needs you|asked about|called to|called in)\b/i.test(
      reason
    );
  if (named || complete) {
    return `${reason}.${extra}`;
  }
  return `${who} called about ${reason}.${extra}`;
}

/**
 * Contacts list/detail. Empty stays None.
 *
 * @param {{
 *   name: string | null,
 *   phone: string | null,
 *   lastReason: string | null,
 *   latestCallReason: string | null,
 * }} opts
 * @returns {string | null}
 */
function displayContactLastReason(opts) {
  const raw = String(opts.latestCallReason || opts.lastReason || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return null;
  const phone = String(opts.phone || "").trim() || "unknown";
  const name = String(opts.name || "").trim() || null;
  return buildSummarySentence({
    name,
    reason: raw,
    callerNumber: phone,
  });
}

module.exports = {
  pickCallOwnerReason,
  buildSummarySentence,
  displayContactLastReason,
};
