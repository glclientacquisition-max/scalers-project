// Per-tenant human handoff preference.

/**
 * @param {unknown} raw
 * @returns {'callback'|'live_transfer'}
 */
function parseHandoffMode(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (v === 'live_transfer' || v === 'livetransfer' || v === 'transfer') {
    return 'live_transfer';
  }
  return 'callback';
}

module.exports = { parseHandoffMode };
