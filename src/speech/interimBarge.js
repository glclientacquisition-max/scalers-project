// Accumulate Soniox interim hypotheses so barge-in can see "wait / stop / hapana"
// even when each interim frame is only a short fragment.

/**
 * Merge successive interim transcripts into one hypothesis.
 * Soniox often sends a growing hypothesis; sometimes a replacement.
 *
 * @param {string} previous
 * @param {string} next
 * @returns {string}
 */
function mergeInterimHypothesis(previous, next) {
  const prev = String(previous || '')
    .replace(/\s+/g, ' ')
    .trim();
  const cur = String(next || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cur) return prev;
  if (!prev) return cur;
  if (cur === prev) return cur;
  if (cur.startsWith(prev)) return cur;
  if (prev.startsWith(cur)) return prev;

  const prevNorm = prev.toLowerCase();
  const curNorm = cur.toLowerCase();
  if (curNorm.includes(prevNorm)) return cur;
  if (prevNorm.includes(curNorm) && cur.length >= 3) return prev;

  // Distinct fragment — append (covers non-cumulative interim streams).
  return `${prev} ${cur}`.replace(/\s+/g, ' ').trim();
}

module.exports = {
  mergeInterimHypothesis,
};
