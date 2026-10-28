'use strict';
// B1 (retire the old brain): fail-closed degradation for the BRAIN_ENGINES / KB v2 brain. EN + SW.
// When the business's facts are missing, the brain never guesses: the tool receipt says the team will confirm
// (or the call goes to the callback capture: name, number, reason, read-back, yes). The understanding engine still
// types the turn, the tools still produce receipts and the response engine still writes the reply; this module
// only reshapes RECEIPTS (facts) and the PLAN's flow. No caller line is fixed here except receipt facts.
//
// Each default is ONE named rule (docs: docs/reference/platform/KB_V2.md, "B1 degradation"). Alvin approved every
// default on 28 Oct (plan §5 Q1, Q5, Q6 + §2c), so they are final. The table below is the only place to flip one;
// tests pass `opts.degradeRules`.
//
//   SPARSE_UNKNOWN_ITEM          Q1  an item the catalogue does not carry gets "the team will confirm" + capture,
//                                    never a plain "we don't offer" (#1004's not_in_catalogue receipt is rewritten),
//                                    UNTIL the catalogue has >= minItems offered items AND the owner marked it complete.
//   EMPTY_CATALOGUE_CAPTURE      §2c an empty snapshot (0 offered items) is valid: no list, no price, no item yes/no;
//                                    any catalogue question opens the callback capture with the ask as the reason.
//   NO_HOURS_BOOKING_AS_REQUEST  Q5  no hours on file: a booking becomes a request for the team to confirm the time
//                                    (the caller's preferred time is kept in the request), no slot is offered;
//                                    "when are you open" gets "the team will confirm" (never a guessed time).
//   UNCONFIRMED_AREAS_NO_VERDICT Q6  coverage is a firm yes / no ONLY from the owner's confirmed area picks. Legacy
//                                    lists, unconfirmed picks and no areas at all: "I'll check with the owner about X",
//                                    no fee, and never an "outside" handoff reason.
//   NO_POLICY_TEAM_CONFIRM       §2c payment / deposit asked with no owner policy on file: "the team will confirm".
const CS = require('./commitSafety');

const RULES = Object.freeze({
  SPARSE_UNKNOWN_ITEM: Object.freeze({ on: true, minItems: 5 }),
  EMPTY_CATALOGUE_CAPTURE: Object.freeze({ on: true }),
  NO_HOURS_BOOKING_AS_REQUEST: Object.freeze({ on: true }),
  UNCONFIRMED_AREAS_NO_VERDICT: Object.freeze({ on: true }),
  NO_POLICY_TEAM_CONFIRM: Object.freeze({ on: true }),
});
const RULE_NAMES = Object.freeze(Object.keys(RULES));

/** The rule table for this turn: the defaults, optionally overridden per rule ({ NAME: false | { on, ... } }). */
function rulesFor(overrides = null) {
  if (!overrides) return RULES;
  const out = {};
  for (const k of RULE_NAMES) {
    const o = overrides[k];
    out[k] = o === undefined ? RULES[k] : (typeof o === 'boolean' ? { ...RULES[k], on: o } : { ...RULES[k], ...o });
  }
  return out;
}
const on = (rules, name) => !!(rules && rules[name] && rules[name].on);

const sw = (lang) => /^sw/i.test(String(lang || ''));
const kbHandle = (profile) => (profile && profile.kb && profile.kb.handle) || null;

/** Offered items in the live snapshot (paused / not offered live in doc.off and do not count). null = not on the KB. */
function offeredCount(profile) {
  const h = kbHandle(profile);
  return h ? ((h.doc && h.doc.items) || []).length : null;
}
/** Owner marked the catalogue complete. No such field is written yet (Desk/Platform): every catalogue reads sparse. */
function ownerMarkedComplete(profile) {
  const h = kbHandle(profile);
  return profile?.kbCatalogueComplete === true || profile?.catalogueComplete === true || (h && h.doc && h.doc.complete === true) || false;
}
/** 'empty' | 'sparse' | 'complete' | null (not on the KB). */
function catalogueState(profile, rules = RULES) {
  const n = offeredCount(profile);
  if (n == null) return null;
  if (n === 0) return 'empty';
  const min = Number(rules.SPARSE_UNKNOWN_ITEM?.minItems ?? 5);
  return n >= min && ownerMarkedComplete(profile) ? 'complete' : 'sparse';
}
function hasHours(profile = {}) {
  const d = profile.hoursSchedule && profile.hoursSchedule.days;
  return !!(d && Object.values(d).some((x) => x && ((x.open && x.close) || x.closed === true)));
}

// ---- the asked item (typed first: #1004 u.catalogue / asked_item, the understanding's service slot; rules last) ----
const ITEM_ASK_EN = /\b(?:do|does|d'?you|can) (?:you|u|y'?all|you guys)\s+(?:sell|have|stock|offer|do|carry|fix|repair|make)\s+(?:any\s+|a\s+|an\s+|the\s+)?([a-z][a-z' -]{1,40}?)\s*\??\s*$/i;
const ITEM_ASK_SW = /\b(?:mnauza|mna|mnayo|mnafanya|unauza|una|kuna)\s+([a-z][a-z' -]{1,40}?)\s*\??\s*$/i;
const NOT_ITEM = /\b(time|today|tomorrow|kesho|leo|weekend|weekends|saturday|sunday|monday|tuesday|wednesday|thursday|friday|jumamosi|jumapili|jumatatu|jumanne|jumatano|alhamisi|ijumaa|hours?|saa|slot|space|nafasi|number|namba|name|jina|delivery|transport|mpesa|m-pesa|payment|deposit|any(?:thing)?|nini|gani)\b/i;
function askedItem(u = {}, text = '', { rulesRead = false } = {}) {
  if (u.catalogue && u.catalogue.kind === 'item' && u.catalogue.item) return String(u.catalogue.item).trim();
  if (u.asked_item) return String(u.asked_item).trim();
  if (u.slots && u.slots.service) return String(u.slots.service).trim();
  if (!rulesRead) return null;
  const t = String(text || '').trim();
  const m = t.match(ITEM_ASK_EN) || t.match(ITEM_ASK_SW);
  const w = m && m[1] ? m[1].trim() : null;
  if (!w || NOT_ITEM.test(w) || w.split(/\s+/).length > 4) return null;
  return w;
}
const CATALOGUE_Q = /\b(what do you (?:offer|sell|have|do)|what (?:services|products)|price|prices|how much|cost|bei|ngapi|mnauza|mnafanya nini|mna nini|huduma gani)\b/i;
/** A catalogue / price question this turn (typed answers first, then the words). */
function asksCatalogue(u = {}, text = '') {
  const a = u.answers || [];
  if (a.includes('services') || a.includes('price')) return true;
  if (u.catalogue) return true;
  if (u.slots && u.slots.service) return true;
  if (a.some((x) => ['hours', 'coverage', 'identity', 'payment'].includes(x))) return false;
  return CATALOGUE_Q.test(String(text || ''));
}

// ---- receipt facts (the response engine words the reply from these; the no-model fallback speaks them) ----
function teamConfirmText(what, lang) {
  const w = what ? String(what).trim() : null;
  if (sw(lang)) return w ? `Nitamwomba mwenye biashara athibitishe kuhusu ${w}.` : 'Nitamwomba mwenye biashara athibitishe hilo.';
  return w ? `I'll have the team confirm ${w} for you.` : "I'll have the team confirm that for you.";
}
function teamConfirmReceipt({ tool = 'catalogue', rule, asked = null, lang, capture = true, profile }) {
  return {
    tool, ok: true, kb: !!kbHandle(profile), kind: 'team_confirm', ids: [], degraded: rule, asked: asked || null,
    ...(capture ? { capture: 'team_confirm' } : {}),
    text: teamConfirmText(asked, lang), ms: 0, kbVersion: profile?.kb?.version ?? null,
  };
}

/**
 * Catalogue rule: given this turn's KB receipt (or null), -> the receipt to keep (maybe a team_confirm) or null.
 * Only for businesses on the KB (profile.kb.handle). Legacy profiles are untouched.
 */
function catalogue({ receipt, u, text, profile, lang, rules = RULES }) {
  const state = catalogueState(profile, rules);
  if (!state) return { receipt, fired: null };
  if (state === 'empty' && on(rules, 'EMPTY_CATALOGUE_CAPTURE')) {
    // an empty snapshot answers no catalogue question itself: no list, no price, no "we don't offer"
    if (receipt || asksCatalogue(u, text) || askedItem(u, text, { rulesRead: true })) {
      return { receipt: teamConfirmReceipt({ rule: 'EMPTY_CATALOGUE_CAPTURE', asked: askedItem(u, text, { rulesRead: true }), lang, profile }), fired: 'EMPTY_CATALOGUE_CAPTURE' };
    }
    return { receipt, fired: null };
  }
  if (state === 'complete' || !on(rules, 'SPARSE_UNKNOWN_ITEM')) return { receipt, fired: null };
  // sparse: #1004's typed miss ("we don't offer pianos") is rewritten; a named item with no KB hit gets the same
  if (receipt && receipt.kind === 'not_in_catalogue') {
    return { receipt: teamConfirmReceipt({ rule: 'SPARSE_UNKNOWN_ITEM', asked: receipt.asked || askedItem(u, text), lang, profile }), fired: 'SPARSE_UNKNOWN_ITEM' };
  }
  // no receipt, or only the overview / a group list for an ask that named one thing: is that thing in the catalogue?
  if (!receipt || receipt.kind === 'overview' || receipt.kind === 'group' || receipt.kind === 'none') {
    const asked = askedItem(u, text);
    const a = u.answers || [];
    if (asked && !a.includes('coverage') && !a.includes('hours')) {
      let hit = null;
      try { hit = require('../../knowledge/kb/source').catalogueSource(profile).findForCaller(asked); } catch { hit = null; }
      if (!hit) return { receipt: teamConfirmReceipt({ rule: 'SPARSE_UNKNOWN_ITEM', asked, lang, profile }), fired: 'SPARSE_UNKNOWN_ITEM' };
    }
  }
  return { receipt, fired: null };
}

/** Area rule: one coverage row -> the row callers may hear. A firm yes / no only from a confirmed area pick. */
function areaRow(row, { rules = RULES } = {}) {
  if (!row || !on(rules, 'UNCONFIRMED_AREAS_NO_VERDICT')) return { row, fired: null };
  const fromPicks = row.source === 'area_picks' || row.source === 'picks';
  const firm = row.covered === 'yes' || row.covered === 'no' || ['covered', 'excluded', 'outside'].includes(row.status);
  if (fromPicks || !firm) return { row, fired: null };
  const name = row.name || row.place || null;
  const AC = require('./areaCoverage');
  const out = {
    ...row, covered: 'unknown', status: 'unknown', via: 'unconfirmed', fee_kes: null, note: null, note_lang: null,
    line_en: AC.checkWithOwnerLine(name, 'en'), line_sw: AC.checkWithOwnerLine(name, 'sw'), degraded: 'UNCONFIRMED_AREAS_NO_VERDICT',
  };
  return { row: out, fired: 'UNCONFIRMED_AREAS_NO_VERDICT' };
}
/** For the handoff trigger: an "outside" verdict counts only when it came from the owner's picks. */
function areaVerdictFirm(r, { rules = RULES } = {}) {
  if (!r) return false;
  if (!on(rules, 'UNCONFIRMED_AREAS_NO_VERDICT')) return true;
  return r.source === 'picks' || r.source === 'area_picks';
}

/** Hours rule: no hours on file -> a team_confirm hours receipt (no time is ever said). */
function hours({ receipt, profile, lang, rules = RULES }) {
  if (!on(rules, 'NO_HOURS_BOOKING_AS_REQUEST') || hasHours(profile)) return { receipt, fired: null };
  if (receipt && receipt.ok && receipt.text) return { receipt, fired: null };
  return {
    receipt: { tool: 'hours', ok: true, kind: 'team_confirm', degraded: 'NO_HOURS_BOOKING_AS_REQUEST', text: sw(lang) ? 'Mwenye biashara atathibitisha saa zetu za kazi. Ungependa akupigie?' : "I'll have the team confirm our hours. Would you like them to call you back?" },
    fired: 'NO_HOURS_BOOKING_AS_REQUEST',
  };
}
/** Booking rule: true when a booking must become a request for the team (no hours, or an empty catalogue). */
function bookingAsRequest(profile, rules = RULES) {
  if (on(rules, 'NO_HOURS_BOOKING_AS_REQUEST') && !hasHours(profile)) return 'NO_HOURS_BOOKING_AS_REQUEST';
  if (on(rules, 'EMPTY_CATALOGUE_CAPTURE') && catalogueState(profile, rules) === 'empty') return 'EMPTY_CATALOGUE_CAPTURE';
  return null;
}

/** Policy rule: payment asked with no owner fact -> team_confirm. */
function policy({ topic, lang, profile, rules = RULES }) {
  if (!on(rules, 'NO_POLICY_TEAM_CONFIRM')) return { receipt: null, fired: null };
  return {
    receipt: { tool: topic, ok: true, kind: 'team_confirm', degraded: 'NO_POLICY_TEAM_CONFIRM', text: sw(lang) ? 'Mwenye biashara atathibitisha malipo. Ungependa akupigie?' : "I'll have the team confirm the payment details. Would you like them to call you back?" },
    fired: 'NO_POLICY_TEAM_CONFIRM',
  };
}

/** Request notes for a degraded callback (what the owner reads in the inbox and the alert). */
function requestNotes({ rule, asked, booking = false, service, when }) {
  const parts = [];
  if (booking) {
    parts.push(`Booking request${service ? `: ${service}` : ''}`);
    if (when && (when.date || when.time)) parts.push(`preferred ${[when.date, when.time].filter(Boolean).join(' ')}`);
    parts.push('please confirm the time with the caller');
  } else if (asked) parts.push(`Caller asked about: ${asked}`);
  else parts.push('Caller asked a question the business has not set up yet');
  return `Callback (${rule}): ${parts.join('; ')}.`;
}

module.exports = {
  RULES, RULE_NAMES, rulesFor, on, catalogueState, offeredCount, ownerMarkedComplete, hasHours, askedItem, asksCatalogue,
  catalogue, areaRow, areaVerdictFirm, hours, bookingAsRequest, policy, requestNotes, teamConfirmText, sayPhone: CS.sayPhone,
};
