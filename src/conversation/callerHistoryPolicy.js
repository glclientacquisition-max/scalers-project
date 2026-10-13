'use strict';
/**
 * BRAIN_TRUST_P1 v3: the ONE caller-history read policy.
 *
 * Every reader of the caller file goes through here: the D199 file lines
 * (state.returning via returningFileFromCard), the prompt card
 * (formatReturningCallerForPrompt), the trust resume offer (open_tasks) and
 * the speech guard (blockedTerms). Rules (Alvin, 13 Oct 23:22):
 * - only open, recent (within retention) rows;
 * - never closed, fulfilled or cancelled rows, never past-dated rows;
 * - nothing before the name is confirmed (only "the file is masked");
 * - a shared phone never gets history, even after a name.
 * Flag off: every function is the identity, so D199/main behaviour is unchanged.
 */

const DAY = 86400000;
const CLOSED = new Set(['fulfilled', 'cancelled', 'canceled', 'done', 'closed', 'completed', 'expired', 'no_show']);

function policyEnabled() {
  // eslint-disable-next-line global-require
  return require('./trustP1').trustP1Enabled();
}

function retentionDays(env = process.env) {
  const n = Number(env.CALLER_HISTORY_RETENTION_DAYS || 60);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

function rowClosed(row) {
  if (!row) return true;
  if (row.closed_at || row.closedAt) return true;
  return CLOSED.has(String(row.status || '').trim().toLowerCase());
}

function rowAt(row) {
  const v = row?.updated_at || row?.updatedAt || row?.created_at || row?.createdAt || null;
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
}

function rowRecent(row, now = Date.now()) {
  const at = rowAt(row);
  // Undated rows cannot be proven old; the retention job removes old rows
  // at the source (memory_retention_runs), so undated = current.
  if (at == null) return true;
  return (now - at) / DAY <= retentionDays();
}

/** One row is readable: open, not past-dated, recent. */
function rowAllowed(row, now = Date.now()) {
  if (!row || rowClosed(row)) return false;
  if (row.past === true || /^past\b/i.test(String(row.when || ''))) return false;
  return rowRecent(row, now);
}

function isShared(card) {
  return Boolean(card?.sharedLine || card?.shared_line || card?.file?.shared_line);
}

function nameConfirmed(card, state) {
  return state?.caller?.nameConfirmed === true || card?.identityBound === true;
}

/** History may be read at all (tier 2 on a single-person line). */
function historyAllowed(card, state = null) {
  if (!card) return false;
  if (isShared(card)) return false;
  return nameConfirmed(card, state);
}

function visitLine(row) {
  return [row.job, row.when, row.status, row.place].filter(Boolean).join(' | '); // same order as callerMemory.clipVisitLine
}

function requestLine(row) {
  return [row.type || 'enquiry', row.job, row.when].filter(Boolean).join(' | ');
}

const HISTORY_FIELDS_NULL = ['lastReason', 'notes', 'place', 'usualJob', 'standing', 'nextAppointment', 'nextVisit',
  'nextVisitService', 'nextVisitWhen', 'nextVisitStatus', 'nextVisitLandmark'];

/**
 * The policy view of a card (or a returning file). Never mutates the input.
 * The raw card stays on profile.callerMemory for the speech guard only.
 */
function filterCard(card, { state = null, now = Date.now() } = {}) {
  if (!card || typeof card !== 'object' || !policyEnabled()) return card;
  const out = { ...card, historyPolicy: true };
  out.recentBookings = []; // history = finished rows: never read
  out.pastOpenCount = 0;
  const rawRows = Array.isArray(card.openRows) ? card.openRows : null;
  const rawTasks = Array.isArray(card.openTasks) ? card.openTasks : null;
  const hadRows = Boolean(
    (rawRows && rawRows.length) ||
      (Array.isArray(card.openVisits) && card.openVisits.length) ||
      (Array.isArray(card.openRequests) && card.openRequests.length) ||
      (rawTasks && rawTasks.some((t) => !rowClosed(t)))
  );
  if (!historyAllowed(card, state)) {
    for (const k of HISTORY_FIELDS_NULL) if (k in out) out[k] = null;
    out.openVisits = [];
    out.openRequests = [];
    if (rawRows) out.openRows = [];
    if (rawTasks) out.openTasks = [];
    // Masked, not empty — only on a single-person line, and only a flag.
    out.hasOpenRows = !isShared(card) && hadRows;
    out.maskedRowCount = out.hasOpenRows ? 1 : 0;
    return out;
  }
  for (const k of ['lastReason', 'notes']) if (k in out) out[k] = null;
  if (rawRows) {
    const rows = rawRows.filter((r) => rowAllowed(r, now));
    out.openRows = rows;
    // Keep the card's own entries (same shape the formatters expect),
    // aligned in order with openRows (structuredOpenRows skips job-less ones).
    const keepAligned = (list, kindRows) => {
      if (!Array.isArray(list)) return list;
      let i = 0;
      return list.filter((entry) => {
        const row = entry && entry.row ? entry.row : entry;
        if (typeof row === 'string') return false;
        const job = row?.service_name || row?.serviceName || row?.item;
        if (!job) return false;
        const structured = kindRows[i++];
        return Boolean(structured && rowAllowed(structured, now));
      });
    };
    const visitRows = rawRows.filter((r) => r.kind === 'visit');
    const requestRows = rawRows.filter((r) => r.kind !== 'visit');
    const objectShaped = (list) => Array.isArray(list) && list.every((e) => e && typeof e === 'object');
    out.openVisits = objectShaped(card.openVisits)
      ? keepAligned(card.openVisits, visitRows)
      : rows.filter((r) => r.kind === 'visit').map(visitLine);
    out.openRequests = objectShaped(card.openRequests)
      ? keepAligned(card.openRequests, requestRows)
      : rows.filter((r) => r.kind !== 'visit').map(requestLine);
    out.nextAppointment = out.openVisits[0] || null;
    if (!out.nextAppointment) {
      for (const k of ['nextVisit', 'nextVisitService', 'nextVisitWhen', 'nextVisitStatus', 'nextVisitLandmark']) if (k in out) out[k] = null;
    }
  }
  if (rawTasks) out.openTasks = rawTasks.filter((t) => rowAllowed(t, now));
  // Place / usual job may come from finished rows: keep them only when an
  // allowed open row carries them.
  const openPlaces = new Set((out.openRows || []).map((r) => String(r.place || '').toLowerCase()).filter(Boolean));
  if (out.place && !openPlaces.has(String(out.place).toLowerCase())) out.place = null;
  const openJobs = new Set((out.openRows || []).map((r) => String(r.job || '').toLowerCase()).filter(Boolean));
  if (out.usualJob && !openJobs.has(String(out.usualJob).toLowerCase())) out.usualJob = null;
  out.hasOpenRows = Boolean(
    (out.openRows && out.openRows.length) || out.openVisits?.length || out.openRequests?.length
  );
  return out;
}

/** Open tasks the trust layer may use right now. */
function allowedTasks(card, state = null, now = Date.now()) {
  const tasks = Array.isArray(card?.openTasks) ? card.openTasks : [];
  if (!policyEnabled()) return tasks;
  if (!historyAllowed(card, state)) return [];
  return tasks.filter((t) => rowAllowed(t, now));
}

function termOf(v) {
  return String(v || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Items on the raw file the caller may NOT hear about right now (closed,
 * old, or everything when history is not allowed). Used by the speech guard
 * together with a history reference, so a plain "carpet cleaning costs…" is
 * never blocked.
 */
function blockedTerms(card, state = null, now = Date.now()) {
  if (!card || !policyEnabled()) return [];
  const allowed = new Set();
  const all = new Set();
  const add = (set, v) => { const t = termOf(v); if (t && t.length >= 4) set.add(t); };
  const ok = historyAllowed(card, state);
  for (const r of Array.isArray(card.openRows) ? card.openRows : []) {
    add(all, r.job); add(all, r.place);
    if (ok && rowAllowed(r, now)) { add(allowed, r.job); add(allowed, r.place); }
  }
  for (const t of Array.isArray(card.openTasks) ? card.openTasks : []) {
    add(all, t.summary_item);
    if (ok && rowAllowed(t, now)) add(allowed, t.summary_item);
  }
  for (const line of Array.isArray(card.recentBookings) ? card.recentBookings : []) {
    for (const part of String(line).split('|')) add(all, part.replace(/^(?:visit|request|hold|enquiry|callback|order)\s*:?/i, ''));
  }
  return [...all].filter((t) => !allowed.has(t) && !/^\d/.test(t));
}

module.exports = {
  policyEnabled,
  retentionDays,
  rowClosed,
  rowAllowed,
  historyAllowed,
  filterCard,
  allowedTasks,
  blockedTerms,
};
