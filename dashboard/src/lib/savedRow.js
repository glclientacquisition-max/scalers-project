/**
 * Saved settings rows stay marked across field edits.
 * The mark is a non-enumerable symbol, so JSON.stringify omits it
 * and a plain object spread drops it. carrySavedRow puts it back.
 */
const SAVED = Symbol("settingsSavedRow");

function markSavedRow(row) {
  Object.defineProperty(row, SAVED, { value: true, enumerable: false });
  return row;
}

function isSavedRow(row) {
  return Boolean(row && row[SAVED]);
}

function carrySavedRow(next, prev) {
  if (isSavedRow(prev)) markSavedRow(next);
  return next;
}

module.exports = { markSavedRow, isSavedRow, carrySavedRow };
