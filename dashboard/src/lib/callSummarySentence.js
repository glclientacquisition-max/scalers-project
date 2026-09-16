/**
 * Same owner sentence Calls uses on the call page.
 * Inbox stays on the hangup one-liner (`reason`).
 * Contact last reason and the Summary Want block use `want`.
 *
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {Record<string, unknown> | null}
 */
function ownerReview(meta) {
  if (!meta || typeof meta !== "object") return null;
  return meta.owner_review &&
    typeof meta.owner_review === "object" &&
    !Array.isArray(meta.owner_review)
    ? meta.owner_review
    : null;
}

function trimText(raw) {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

/**
 * Inbox one-liner. Hangup `reason` first, then Want, then live reason.
 *
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {string | null}
 */
function pickCallOwnerReason(meta) {
  const review = ownerReview(meta);
  const fromReview = review ? trimText(review.reason) : "";
  if (fromReview) return fromReview;
  const fromWant = review ? trimText(review.want) : "";
  if (fromWant) return fromWant;
  const fromReason = meta ? trimText(meta.reason) : "";
  return fromReason || null;
}

/**
 * Call Summary Want + contact last reason. Same sentence on both screens.
 *
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {string | null}
 */
function pickCallOwnerWant(meta) {
  const review = ownerReview(meta);
  const fromWant = review ? trimText(review.want) : "";
  if (fromWant) return fromWant;
  return pickCallOwnerReason(meta);
}

/**
 * Four-block hangup card. Null when hangup review has not landed.
 *
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {{
 *   want: string | null,
 *   done: string | null,
 *   mood: string | null,
 *   next: string | null,
 * } | null}
 */
function pickCallOwnerCard(meta) {
  const review = ownerReview(meta);
  if (!review) return null;
  const want = trimText(review.want) || trimText(review.reason) || null;
  const done = trimText(review.done) || null;
  const mood = trimText(review.mood) || null;
  const next = trimText(review.next) || null;
  const moodKnown = Boolean(mood && mood !== "unknown");
  if (!want && !done && !next && !moodKnown) return null;
  return { want, done, mood, next };
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
 * Contacts list/detail. Empty stays None. Prefers latest call Want.
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
  pickCallOwnerWant,
  pickCallOwnerCard,
  buildSummarySentence,
  displayContactLastReason,
};
