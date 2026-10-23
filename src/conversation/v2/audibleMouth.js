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

/** D199/card rows use `job`; machine norm uses `service`; liveTurn maps service_name. */
function rowServiceLabel(r) {
  if (!r || typeof r !== 'object') return '';
  return String(r.service || r.service_name || r.job || r.item || '').trim();
}

/** Normalize a file/open row so templates always see `.service`. Never invents. */
function normalizeJobRow(r) {
  if (!r || typeof r !== 'object') return null;
  const service = rowServiceLabel(r);
  if (!service) return null;
  if (r.status === 'cancelled') return null;
  return { ...r, service };
}

/** First usable visit/request row (open or last_visit seed). Never invents.
 *  Accepts D199 `job`, liveTurn `service_name`, or machine `service`. */
function lastJobRow(file = {}) {
  const rows = Array.isArray(file.openRows) ? file.openRows : [];
  for (const r of rows) {
    const n = normalizeJobRow(r);
    if (n) return n;
  }
  const lv = normalizeJobRow(file.lastVisit);
  return lv || null;
}

function welcomeBackLine(name, lang) {
  if (!name) return null;
  return R.info({ kind: 'welcome_back', name }, lang);
}

function lastJobLine(row, lang) {
  const n = normalizeJobRow(row);
  if (!n) return null;
  return R.info({ kind: 'file', rows: [n] }, lang, 0);
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
    || (Array.isArray(state.file?.openRows) && state.file.openRows.some((r) => rowServiceLabel(r)))
    || Boolean(rowServiceLabel(state.file?.lastVisit))
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

/**
 * Voice composeOpening card — field names locked with Voice @ tip 45c2d51f.
 * nameConfirmed is THIS TENANT only; never copy another tenant's flag.
 * Voice TTS uses identity+welcome only (ignores openRows/lastVisit).
 * Last-job without Gemini is Brain machine.file/slots seed (rulesMouthSeed).
 */
function bindSafeOpeningCard(file = {}, slots = {}, staffNames = [], extras = {}) {
  const sharedLine = file.sharedLine === true;
  const name = bindSafeName(file, slots, staffNames);
  const nameConfirmed = !sharedLine && (
    slots.nameConfirmed === true || file.nameConfirmed === true
  ) && Boolean(name);
  const knownName = nameConfirmed ? name : (
    !sharedLine && (file.contactName || file.displayName)
      ? String(file.contactName || file.displayName).trim()
      : ''
  );
  const openRows = Array.isArray(file.openRows) ? file.openRows : [];
  const returning = file.returning === true
    || Boolean(nameConfirmed && knownName)
    || openRows.some((r) => rowServiceLabel(r))
    || Boolean(rowServiceLabel(file.lastVisit));
  const ll = String(extras.lastLanguage || file.lastLanguage || '').toLowerCase();
  const lastLanguage = ll === 'en' || ll === 'sw' ? ll : null;
  return {
    knownName: knownName || '',
    nameConfirmed: nameConfirmed === true,
    isReturning: returning,
    lastLanguage,
    sharedLine,
    openRows,
    // Brain-only hint (Voice ignores): lastVisit for rulesMouthSeed consumers.
    lastVisit: file.lastVisit || null,
  };
}

/** Per-tenant confirm: name on file but this tenant's name_confirmed is false. Never invent. */
function needsNameConfirm(file = {}, slots = {}) {
  if (file.sharedLine === true) return false;
  if (slots.nameConfirmed === true || file.nameConfirmed === true) return false;
  const onFile = String(file.contactName || file.displayName || '').trim();
  return Boolean(onFile);
}

/**
 * Apply confirm for THIS tenant contact only (in-memory state).
 * Does not copy flags across tenants. Does not invent a name.
 * Caller must invoke confirmCallerName handler for durable flip.
 */
function applyTenantConfirm(state, { yes = false, name = null } = {}) {
  if (!state || !yes) return { ok: false, reason: 'no_yes' };
  if (state.file?.sharedLine === true) return { ok: false, reason: 'shared_line' };
  const candidate = String(name || state.slots?.name || state.file?.contactName || state.file?.displayName || '').trim();
  if (!candidate) return { ok: false, reason: 'no_name_on_file' };
  // Never invent: candidate must already be on this tenant's file or this-call slot.
  const onFile = String(state.file?.contactName || state.file?.displayName || '').trim().toLowerCase();
  const onSlot = String(state.slots?.name || '').trim().toLowerCase();
  if (candidate.toLowerCase() !== onFile && candidate.toLowerCase() !== onSlot) {
    return { ok: false, reason: 'name_mismatch' };
  }
  state.slots = state.slots || {};
  state.slots.name = candidate;
  state.slots.nameConfirmed = true;
  if (state.file) state.file.nameConfirmed = true;
  return { ok: true, name: candidate, tenantOnly: true };
}

/** Criteria stub for confirm ask — Prompt owns final wording later. */
function confirmNameAskLine(name, lang) {
  const n = String(name || '').trim();
  if (!n) return null;
  const sw = String(lang || '').toLowerCase().startsWith('sw');
  // Neutral criteria line (not owner-facing Prompt craft).
  return sw
    ? `Je, naongea na ${n}?`
    : `Am I speaking with ${n}?`;
}

/**
 * Rules mouth seed at T0 — independent of model proposal.
 * Speaks bind-safe welcome-back and/or one last-job line from openRows/lastVisit.
 * Mute name when unconfirmed/shared. Never invents.
 * Marks state.welcomed / state.fileSeeded so we don't double-speak.
 */
function rulesMouthSeed(state, lang) {
  if (!state) return null;
  const parts = [];
  const file = state.file || {};
  const slots = state.slots || {};

  // Unconfirmed returner with name on file → confirm ask once (no name greet).
  if (!state.welcomed && needsNameConfirm(file, slots) && !state.nameConfirmAsked) {
    const onFile = String(file.contactName || file.displayName || '').trim();
    const ask = confirmNameAskLine(onFile, lang);
    if (ask) {
      state.nameConfirmAsked = true;
      state.expecting = 'name_confirm';
      state.welcomed = true; // avoid stock reopen looping the ask
      return ask;
    }
  }

  if (!state.welcomed) {
    const wb = openingKnownSpeech(state, lang);
    if (wb) {
      parts.push(wb);
      state.welcomed = true;
    }
  }

  if (!state.fileSeeded) {
    const row = lastJobRow(file);
    if (row) {
      const job = lastJobLine(row, lang);
      if (job) {
        parts.push(job);
        state.fileSeeded = true;
        state.lastInfo = 'recall';
      }
    }
  }

  if (!parts.length) return null;
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Score: mouth seed acted without a model proposal. */
function scoreRulesMouthSeed({ spokenLine, name, lastJobService, modelTimedOut = true, nameConfirmed = true, sharedLine = false }) {
  const line = String(spokenLine || '');
  const namedGreet = /welcome back|karibu tena/i.test(line) && name
    && line.toLowerCase().includes(String(name).toLowerCase());
  if ((sharedLine || nameConfirmed === false) && namedGreet) {
    return { ok: false, verdict: 'invented_name', reason: 'unconfirmed_or_shared_named_greet' };
  }
  if (!modelTimedOut) return { ok: true, verdict: 'n/a', reason: 'model_not_forced_timeout' };
  const job = String(lastJobService || '').trim();
  const jobTok = job ? job.toLowerCase().split(/[,(]/)[0].trim() : '';
  const jobOk = !jobTok || line.toLowerCase().includes(jobTok);
  const nameOk = !name || nameConfirmed !== true || sharedLine
    || line.toLowerCase().includes(String(name).toLowerCase());
  if (nameConfirmed === true && !sharedLine && name && !nameOk && !jobOk) {
    return { ok: false, verdict: 'mute', reason: 'seed_missed_name_and_job' };
  }
  if (job && !jobOk && nameConfirmed === true) {
    return { ok: false, verdict: 'no_last_job', reason: 'open_row_not_spoken' };
  }
  return { ok: true, verdict: 'seeded', reason: 'rules_mouth_without_model' };
}

module.exports = {
  bindSafeName,
  bindSafeOpeningCard,
  rowServiceLabel,
  normalizeJobRow,
  lastJobRow,
  welcomeBackLine,
  lastJobLine,
  openingKnownSpeech,
  recallKnownSpeech,
  rulesMouthSeed,
  needsNameConfirm,
  applyTenantConfirm,
  confirmNameAskLine,
  speakSafeLine,
  isHollowReopen,
  scoreAudibleActing,
  scoreRulesMouthSeed,
  lookupFileSeedsRecall,
  HOLLOW_REOPEN,
};
