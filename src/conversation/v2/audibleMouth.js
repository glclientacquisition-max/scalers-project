'use strict';
// C7 audible mouth: validated known facts → template speech only.
// Model plaintext is never spoken. Writes stay propose-only (commit:false) until C1.
const R = require('./receipts');

const HOLLOW_REOPEN = /\b(ungependa tufanye nini|how can i help you today|karibu,? tukusaidie vipi|which service do you need|what would you like to do|sorry,? are you calling to book)\b/i;
const STAFF_BLOCK = (staff, name) => {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return true;
  return (staff || []).some((s) => String(s).toLowerCase() === n);
};

/** Bind-safe display name: confirmed + not shared line + not a staff name. */
function bindSafeName(file = {}, slots = {}, staffNames = []) {
  if (file.sharedLine === true) return null;
  const fromSlots = slots.nameConfirmed === true ? String(slots.name || '').trim() : '';
  const fromFile = file.nameConfirmed === true || file.nameConfirmed == null
    ? String(file.contactName || file.displayName || '').trim()
    : '';
  // Prefer this-call confirmed slot; else file-bound contact when not explicitly unconfirmed.
  const name = fromSlots || (file.nameConfirmed === true ? fromFile : (slots.nameConfirmed === true ? fromSlots : fromFile));
  if (!name) return null;
  // Shared-line lock already applied; still refuse staff aliases.
  if (STAFF_BLOCK(staffNames, name) || STAFF_BLOCK(file.staffNames, name)) return null;
  // Unbound / explicitly unconfirmed file with no slot confirm → mute name.
  if (!fromSlots && file.nameConfirmed === false) return null;
  // Require an explicit confirm somewhere: slot or file flag true, or contactName with returning+nameConfirmed.
  const confirmed = slots.nameConfirmed === true || file.nameConfirmed === true
    || (Boolean(fromFile) && file.returning === true && file.nameConfirmed !== false && file.sharedLine !== true);
  if (!confirmed) return null;
  return name;
}

/** First usable visit/request row (open or last_visit seed). Never invents. */
function lastJobRow(file = {}) {
  const rows = Array.isArray(file.openRows) ? file.openRows : [];
  const open = rows.filter((r) => r && r.status !== 'cancelled' && r.service);
  if (open.length) return open[0];
  const lv = file.lastVisit;
  if (lv && lv.service) return lv;
  return null;
}

function welcomeBackLine(name, lang) {
  if (!name) return null;
  return R.info({ kind: 'welcome_back', name }, lang);
}

function lastJobLine(row, lang) {
  if (!row || !row.service) return null;
  return R.info({ kind: 'file', rows: [row] }, lang, 0);
}

/**
 * Opening / early-turn speech from known facts.
 * Returner + bind-safe name → welcome back with name.
 * Shared line / unknown → null (caller keeps stock open).
 */
function openingKnownSpeech(state, lang) {
  if (!state || state.welcomed) return null;
  const name = bindSafeName(state.file || {}, state.slots || {}, state.staffNames || []);
  if (!name) return null;
  const returning = state.file?.returning === true
    || (Array.isArray(state.file?.openRows) && state.file.openRows.some((r) => r && r.service))
    || Boolean(state.file?.lastVisit?.service)
    || Boolean(state.file?.contactName && state.file?.nameConfirmed === true);
  if (!returning) return null;
  return welcomeBackLine(name, lang);
}

/**
 * Recall / lookup_file seed → speak last job once from file rows.
 * Never uses model text. Empty file → honest empty template (receipts file/no_rows).
 */
function recallKnownSpeech(state, lang, n = 0) {
  const row = lastJobRow(state.file || {});
  if (row) return lastJobLine(row, lang);
  const rows = (state.file?.openRows || []).filter((r) => r && r.status !== 'cancelled');
  return R.info({ kind: 'file', rows }, lang, n);
}

/** Model plaintext must never reach TTS. */
function speakSafeLine(templateLine, modelText) {
  void modelText; // explicitly dropped
  return String(templateLine || '').trim();
}

function isHollowReopen(line) {
  return HOLLOW_REOPEN.test(String(line || ''));
}

/**
 * B2 score: valid lookup_file / last_visit proposal + hollow reopen with zero
 * last-job tokens → FAIL (consulting-only). Acting = spoken cites the job label.
 */
function scoreAudibleActing({ proposal, spokenLine, lastJobService }) {
  const tool = proposal && proposal.tool;
  const topic = proposal && proposal.args && proposal.args.topic;
  const validLookup = tool === 'lookup_file'
    && proposal.valid !== false
    && (topic === 'last_visit' || topic === 'open_tasks' || topic === 'orders' || !topic);
  const line = String(spokenLine || '');
  const job = String(lastJobService || '').trim();
  const jobToken = job
    ? line.toLowerCase().includes(job.toLowerCase().split(/[,(]/)[0].trim().toLowerCase())
    : false;
  if (!validLookup) return { ok: true, verdict: 'n/a', reason: 'no_valid_lookup' };
  if (job && jobToken) return { ok: true, verdict: 'acting', reason: 'last_job_spoken' };
  if (isHollowReopen(line)) {
    return { ok: false, verdict: 'consulting_only', reason: 'lookup_ignored_hollow_reopen' };
  }
  if (job && !jobToken) {
    return { ok: false, verdict: 'consulting_only', reason: 'lookup_valid_job_not_spoken' };
  }
  return { ok: true, verdict: 'acting', reason: 'non_hollow_after_lookup' };
}

/** True when a validated model lookup_file should seed the rules recall path. */
function lookupFileSeedsRecall(mc) {
  if (!mc || !Array.isArray(mc.calls)) return false;
  return mc.calls.some((c, i) => {
    const check = mc.checks && mc.checks[i];
    if (!check || !check.ok) return false;
    if (c.name !== 'lookup_file') return false;
    const topic = c.args && c.args.topic;
    return !topic || topic === 'last_visit' || topic === 'open_tasks' || topic === 'orders';
  });
}

module.exports = {
  bindSafeName,
  lastJobRow,
  welcomeBackLine,
  lastJobLine,
  openingKnownSpeech,
  recallKnownSpeech,
  speakSafeLine,
  isHollowReopen,
  scoreAudibleActing,
  lookupFileSeedsRecall,
  HOLLOW_REOPEN,
};
