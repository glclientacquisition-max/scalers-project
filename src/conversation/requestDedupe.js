// Per-call create_service_request dedupe. Same (type, item) within a short
// window returns the prior row instead of inserting another. Used only when
// VOICE_OWED_CONFIRM_FOLD is on.

const DEFAULT_WINDOW_MS = 60 * 1000;

function requestKey(type, item) {
  const t = String(type || '')
    .trim()
    .toLowerCase();
  const i = String(item || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return `${t}|${i}`;
}

/**
 * @param {object} state brain state for this call
 * @param {{ type?: string, item?: string }} request
 * @param {{ now?: number, windowMs?: number }} [opts]
 * @returns {object|null} prior created row when this is a duplicate
 */
function findDuplicateServiceRequest(state, request, opts = {}) {
  if (!state || typeof state !== 'object') return null;
  const conv = state.conversation;
  if (!conv || typeof conv !== 'object') return null;
  const rows = Array.isArray(conv.recentServiceRequests) ? conv.recentServiceRequests : [];
  const key = requestKey(request?.type, request?.item);
  if (!key || key === '|') return null;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const windowMs = Number.isFinite(opts.windowMs) ? opts.windowMs : DEFAULT_WINDOW_MS;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || requestKey(row.type, row.item) !== key) continue;
    if (now - Number(row.at || 0) > windowMs) continue;
    return row.created || { id: row.id, request_type: row.type, deduped: true };
  }
  return null;
}

/**
 * Remember a successful create so a later duplicate can be blocked.
 * @param {object} state
 * @param {{ type?: string, item?: string }} request
 * @param {object} created
 * @param {{ now?: number }} [opts]
 */
function noteServiceRequestCreated(state, request, created, opts = {}) {
  if (!state || typeof state !== 'object' || !created) return;
  if (!state.conversation || typeof state.conversation !== 'object') state.conversation = {};
  const list = Array.isArray(state.conversation.recentServiceRequests)
    ? state.conversation.recentServiceRequests
    : [];
  list.push({
    type: String(request?.type || created.request_type || '').trim().toLowerCase(),
    item: String(request?.item || created.item || '').trim(),
    id: created.id || null,
    at: Number.isFinite(opts.now) ? opts.now : Date.now(),
    created,
  });
  // Cap memory; only the last few matter for a call.
  state.conversation.recentServiceRequests = list.slice(-8);
}

module.exports = {
  DEFAULT_WINDOW_MS,
  requestKey,
  findDuplicateServiceRequest,
  noteServiceRequestCreated,
};
