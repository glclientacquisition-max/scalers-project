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


/** R7a: validated C7 read proposals → Train templates (never model prose). */
const R7_READS = new Set(['get_price', 'check_availability', 'get_hours']);

/**
 * True when rules mouth would be repair / didn't-catch / which-one / hollow reopen.
 * Override gate for R7a — do not override Train-true info lines.
 */
function rulesMouthWouldHollow(u = {}) {
  const intents = Array.isArray(u.intents) ? u.intents : [];
  if (u.fragment && !u.service && !u.area) return true;
  // follow-up on a services list with no bound row → which-one / service_detail loop
  if (u.followup && !u.service && intents.some((i) => ['services', 'explain', 'want_know'].includes(i))) return true;
  if (intents.includes('explain') && !u.service) return true;
  if (intents.includes('price') && !u.service && !(u.products && u.products.length)) return true;
  if (!intents.length && !u.service && !u.area && !(u.products && u.products.length) && !u.ack && !u.yes && !u.no && !u.done) return true;
  return false;
}

/** First validateCall/validateProposal-ok read tool (not lookup_file — that has its own seed). */
function validatedReadProposal(mc) {
  if (!mc || !Array.isArray(mc.calls)) return null;
  for (let i = 0; i < mc.calls.length; i++) {
    const c = mc.calls[i];
    const check = mc.checks && mc.checks[i];
    if (!check || !check.ok) continue;
    if (!R7_READS.has(c.name)) continue;
    return { tool: c.name, args: (c.args && typeof c.args === 'object') ? c.args : {}, index: i };
  }
  return null;
}

function resolveServiceById(id, profile) {
  if (!id || !profile) return null;
  try {
    const FS = require('../../knowledge/factStore');
    if (FS.factStoreEnabled()) {
      const f = (FS.factsFor(profile).services || []).find((s) => s.id === id);
      if (f) return { ...f.row, name: f.row.name || f.name, factId: f.id, notes: f.row.notes || '', price_range: f.row.price_range || null, pricing: f.row.pricing };
    }
  } catch { /* fall through */ }
  const row = (profile.servicesCatalog || []).find((s) => s && s.id === id);
  return row ? { ...row } : null;
}

function resolveProductById(id, profile) {
  if (!id || !profile) return null;
  try {
    const FS = require('../../knowledge/factStore');
    if (FS.factStoreEnabled()) {
      const f = (FS.factsFor(profile).products || []).find((p) => p.id === id);
      if (f) return { ...f.row, name: f.name, product_id: f.id, price: f.row.price, in_stock: f.inStock };
    }
  } catch { /* fall through */ }
  const row = (profile.productCatalog || []).find((p, i) => (p.id || `prd_${i}`) === id);
  return row ? { ...row, product_id: row.id || id } : null;
}

function bindAreaFromProposal(name, profile) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  let listed = [];
  try { listed = require('../listedAreas').listedAreaIds(profile || {}); } catch { listed = []; }
  const hit = listed.find((a) => a === low || a.split(/\s+/).pop() === low);
  if (hit) return { listed: true, name: hit.replace(/\b\w/g, (c) => c.toUpperCase()) };
  const cap = raw.replace(/\b\w/g, (c) => c.toUpperCase()).split(/[ ,]/)[0];
  return { listed: false, name: cap };
}

/**
 * R7a bridge: map a validated read proposal → slot/intent seed for infoAnswer/explain/coverage.
 * Returns null when no ok read, or when rules already have Train-true info (override=false path
 * still returns null so the caller leaves rules unchanged).
 */
function validatedReadSeeds(mc, { profile = {}, u = {} } = {}) {
  const prop = validatedReadProposal(mc);
  if (!prop) return null;

  if (prop.tool === 'get_hours') {
    if (!rulesMouthWouldHollow(u) && (u.intents || []).includes('hours')) return null; // rules already hours
    if (!rulesMouthWouldHollow(u) && (u.intents || []).length && !(u.intents || []).includes('hours')) return null;
    const hollow = rulesMouthWouldHollow(u) || !(u.intents || []).includes('hours');
    if (!hollow) return null;
    return { tool: prop.tool, kind: 'hours', day: prop.args.day || null, override: true };
  }

  if (prop.tool === 'get_price') {
    const service = resolveServiceById(prop.args.service_id, profile);
    const product = resolveProductById(prop.args.product_id, profile);
    if (!service && !product) return null;
    // Override only when rules would which-price / hollow; leave Train-true bound price alone
    if (u.service && (u.intents || []).includes('price') && !rulesMouthWouldHollow(u)) return null;
    if (!rulesMouthWouldHollow(u) && u.service && !((u.intents || []).includes('price'))) return null;
    const hollow = rulesMouthWouldHollow(u) || (!u.service && !(u.products && u.products.length));
    if (!hollow) return null;
    return { tool: prop.tool, kind: 'price', service, product, override: true };
  }

  if (prop.tool === 'check_availability') {
    // Area (Kericho class): seed when rules did not bind the named town
    if (prop.args.area) {
      const area = bindAreaFromProposal(prop.args.area, profile);
      if (!area) return null;
      const already = u.area && String(u.area.name || '').toLowerCase() === String(area.name).toLowerCase();
      if (already) return null;
      return { tool: prop.tool, kind: 'coverage', area, override: true };
    }
    const service = resolveServiceById(prop.args.service_id, profile);
    const product = resolveProductById(prop.args.product_id, profile);
    if (!service && !product) return null;
    // Rules already Train-true for this service (bound explain/offered) → leave
    if (u.service && !rulesMouthWouldHollow(u)) return null;
    if (!rulesMouthWouldHollow(u) && (u.intents || []).includes('services') && !u.followup) return null; // fixture (f) list
    const hollow = rulesMouthWouldHollow(u) || !u.service;
    if (!hollow) return null;
    const text = String(u.text || '');
    const wantExplain = u.followup
      || (u.intents || []).includes('explain')
      || /\b(tell me (a bit |a little |more )?about|nieleze|niambie|what (exactly|does|is)|baada|after[\s-]?build|maana|mean)\b/i.test(text);
    const wantPrice = (u.intents || []).includes('price') || /\b(how much|ngapi|price|gharama)\b/i.test(text);
    const kind = wantPrice ? 'price' : (wantExplain ? 'explain' : 'availability');
    return { tool: prop.tool, kind, service, product, override: true };
  }
  return null;
}

/** Apply R7a seed onto NLU turn `u` (mutates). Returns the seed or null. */
function applyValidatedReadSeed(mc, u, profile, state) {
  const seed = validatedReadSeeds(mc, { profile, u, state });
  if (!seed || !seed.override) return null;
  if (seed.service) u.service = seed.service;
  if (seed.product) u.products = [seed.product];
  if (seed.area) {
    u.area = seed.area;
    if (!u.place) u.place = seed.area.name;
  }
  const drop = (name) => {
    const i = u.intents.indexOf(name);
    if (i >= 0) u.intents.splice(i, 1);
  };
  if (seed.kind === 'explain') {
    drop('services'); drop('want_know');
    if (!u.intents.includes('explain')) u.intents.unshift('explain');
  } else if (seed.kind === 'price') {
    drop('services'); drop('want_know');
    if (!u.intents.includes('price')) u.intents.unshift('price');
  } else if (seed.kind === 'coverage') {
    if (!u.intents.includes('coverage')) u.intents.unshift('coverage');
  } else if (seed.kind === 'hours') {
    if (!u.intents.includes('hours')) u.intents.unshift('hours');
  } else if (seed.kind === 'availability') {
    drop('services');
    if (!u.intents.includes('availability')) u.intents.unshift('availability');
  }
  return seed;
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
  rulesMouthWouldHollow,
  validatedReadProposal,
  validatedReadSeeds,
  applyValidatedReadSeed,
  resolveServiceById,
  bindAreaFromProposal,
  HOLLOW_REOPEN,
};
