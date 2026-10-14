'use strict';

/**
 * BRAIN_TRUST_P1 caller-name control (design: briefs/caller-names-research.md).
 * Generic rules only — no tenant or person lists. One place for:
 *  - binding by STT confidence (Soniox per-token), common-word names, spelling;
 *  - the ask budget hint (ask only when a save/handover/SMS needs it, say why);
 *  - speaking the name (never before confirmed, about twice per call);
 *  - honorifics mirrored only from the caller's own form;
 *  - staff names never taken as the caller ("calling for Peter");
 *  - confirmed-name-or-phone for handovers and SMS;
 *  - apostrophes in names stripped at the TTS boundary.
 */

const BIND_MIN = 0.85;
const CONFIRM_MIN = 0.65;
const NAME_SPEAK_MAX = 2;

function on() {
  return String(process.env.BRAIN_TRUST_P1 || '').trim() === 'on';
}

function trustState(state) {
  if (!state.trust) state.trust = {};
  return state.trust;
}

// ------------------------------------------------------------ confidence

/** Min Soniox confidence over the letter-bearing tokens that spell `name`. null = unknown. */
function nameConfidence(name, tokens) {
  const target = String(name || '').toLowerCase().replace(/[^\p{L}]/gu, '');
  if (!target || !Array.isArray(tokens) || !tokens.length) return null;
  const rows = tokens
    .filter((t) => t && typeof t.text === 'string' && /\p{L}/u.test(t.text))
    .map((t) => ({ letters: t.text.toLowerCase().replace(/[^\p{L}]/gu, ''), c: t.confidence }));
  // Find the contiguous token run whose letters cover the name.
  for (let i = 0; i < rows.length; i += 1) {
    let acc = '';
    const confs = [];
    for (let j = i; j < rows.length && acc.length < target.length; j += 1) {
      acc += rows[j].letters;
      confs.push(rows[j].c);
      if (acc === target) {
        const known = confs.filter((c) => typeof c === 'number');
        return known.length === confs.length ? Math.min(...known) : null;
      }
      if (!target.startsWith(acc)) break;
    }
  }
  return null;
}

// ------------------------------------------------------------- spelling

const LETTER_WORDS = {
  ay: 'a', bee: 'b', see: 'c', cee: 'c', dee: 'd', ee: 'e', ef: 'f', gee: 'g', aitch: 'h', eye: 'i', jay: 'j',
  kay: 'k', el: 'l', em: 'm', en: 'n', oh: 'o', pee: 'p', cue: 'q', queue: 'q', ar: 'r', are: 'r', ess: 's',
  tee: 't', you: 'u', vee: 'v', ex: 'x', why: 'y', zed: 'z', zee: 'z',
};

/**
 * "W A N J I R U", "W-A-N-J-I-R-U", "double N", "it's spelled A C H I E N G" → "Wanjiru".
 * Returns '' unless at least 3 letters were spelled one by one.
 */
function parseSpelledName(text) {
  let t = String(text || '').toLowerCase();
  t = t.replace(/^.*?\b(?:spelled|spelt|spelling(?: is)?|inaandikwa|ni herufi)\b[:\s]*/i, '');
  const parts = t.split(/[\s,.\-–—]+/).filter(Boolean);
  const letters = [];
  let run = 0;
  let best = [];
  for (let i = 0; i < parts.length; i += 1) {
    const w = parts[i];
    let add = null;
    if (/^\p{L}$/u.test(w)) add = [w];
    else if (LETTER_WORDS[w]) add = [LETTER_WORDS[w]];
    else if ((w === 'double' || w === 'mbili') && /^\p{L}$/u.test(parts[i + 1] || '')) { add = [parts[i + 1], parts[i + 1]]; i += 1; }
    else if (w === 'apostrophe') add = ["'"];
    if (add) { letters.push(...add); run += add.length; }
    else { if (run > best.length) best = letters.splice(0); else letters.splice(0); run = 0; }
  }
  if (letters.length > best.length) best = letters;
  const word = best.join('');
  if (word.replace(/'/g, '').length < 3) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ------------------------------------------------------ common-word names

// Given names that are also everyday words: never bind silently; read back.
const COMMON_WORD_NAME = new Set([
  'welcome', 'mercy', 'faith', 'peace', 'hope', 'grace', 'joy', 'sure', 'fine', 'patience', 'charity', 'precious',
  'blessing', 'gift', 'lucky', 'sunday', 'monday', 'baraka', 'neema', 'amani', 'imani', 'rehema', 'zawadi', 'furaha',
  'mimi', 'sasa', 'innocent', 'brilliant', 'honest', 'success', 'victory', 'wisdom', 'purity', 'loyal',
]);

function isCommonWordName(name) {
  const words = String(name || '').toLowerCase().split(/\s+/).filter(Boolean);
  return words.length === 1 && COMMON_WORD_NAME.has(words[0]);
}

// ----------------------------------------------------------- staff names

const STAFF_LEAD = /\b(?:calling for|call(?:ing)? to (?:speak|talk) (?:to|with)|(?:speak|talk) (?:to|with)|looking for|ask(?:ing)? for|is \w+ (?:there|around|in)|nataka kuongea na|naomba kuongea na|nimpate|namtafuta|nipe|niunganishe na|for)\s+(?:mr\.?|mrs\.?|ms\.?|madam|mama|bwana|mzee)?\s*$/i;

/** True when `name` appears in `text` only as someone the caller wants (staff), not themselves. */
function isStaffMention(text, name, profile = {}) {
  if (!on()) return false;
  const raw = String(text || '');
  const n = String(name || '').trim();
  if (!n) return false;
  const lowered = raw.toLowerCase();
  const idx = lowered.indexOf(n.toLowerCase());
  if (idx < 0) return false;
  const before = raw.slice(0, idx);
  if (STAFF_LEAD.test(before)) return true;
  // A name the tenant lists as staff is never the caller unless they say "my name is".
  const staff = staffNames(profile);
  if (staff.has(n.toLowerCase()) && !/\b(?:my name is|naitwa|jina langu ni|i am|i'm|ni mimi)\b/i.test(before)) return true;
  return false;
}

function staffNames(profile = {}) {
  const out = new Set();
  const lists = [profile.staff, profile.team, profile.teamMembers, profile.escalationContacts, profile.businessPolicies?.staff];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const full = String((row && (row.name || row.full_name)) || row || '').trim().toLowerCase();
      if (!full) continue;
      out.add(full);
      for (const part of full.split(/\s+/)) if (part.length >= 3) out.add(part);
    }
  }
  return out;
}

// ------------------------------------------------------------ binding

/**
 * Called by brainState right after the name is resolved for a caller turn.
 * May turn a fresh bind into a pending confirm / re-ask. Mutates `next`.
 */
function afterNameResolution(prev, next, input = {}) {
  if (!on() || !next?.caller) return;
  const t = trustState(next);
  const text = String(input.text || '');
  const tokens = Array.isArray(input.sttTokens) ? input.sttTokens : [];
  const wasConfirmed = Boolean(prev?.caller?.nameConfirmed);

  // A spelling always wins (after an ask, a candidate, or any time a name is pending/known).
  const spelled = parseSpelledName(text);
  if (spelled && (t.nameAsk?.pending || t.nameCandidate || next.caller.name || prev?.caller?.name || /\bspel/i.test(text))) {
    next.caller.name = spelled;
    next.caller.nameConfirmed = true;
    next.caller.nameSpelled = true;
    t.nameCandidate = null;
    t.nameReadback = spelled;
    if (next.entities) next.entities.name = { value: spelled, source: 'caller_spelled', confidence: 1, confirmed: true };
    return;
  }

  // A pending candidate: yes binds it; no / a new name clears it.
  if (t.nameCandidate && !wasConfirmed) {
    const { isNameAffirmation, isNameNegation } = require('./entityExtraction');
    if (isNameAffirmation(text)) {
      next.caller.name = t.nameCandidate.name;
      next.caller.nameConfirmed = true;
      t.nameReadback = null; // the caller just confirmed it; no second readback
      t.nameCandidate = null;
      return;
    }
    if (isNameNegation(text)) t.nameCandidate = null;
  }

  if (wasConfirmed || next.caller.nameConfirmed !== true) return;
  const name = String(next.caller.name || '').trim();
  if (!name) return;

  // A yes to "Am I speaking with <file name>?" binds the file name; no STT check.
  const fileName = String(prev?.caller?.fileNameAsked || prev?.returning?.fileOwnerName || '').trim();
  if (fileName && fileName.toLowerCase() === name.toLowerCase() && !text.toLowerCase().includes(name.toLowerCase())) return;

  if (isStaffMention(text, name, input.profile)) {
    revert(next, prev);
    return;
  }
  const conf = nameConfidence(name, tokens);
  const common = isCommonWordName(name);
  if (conf !== null && conf < CONFIRM_MIN) {
    revert(next, prev);
    t.nameReask = true; // "Sorry, I didn't catch your name."
    return;
  }
  if (common || (conf !== null && conf < BIND_MIN)) {
    revert(next, prev);
    t.nameCandidate = { name, conf, common };
    return;
  }
  // Confident: bind, and read it back once explicitly.
  t.nameReadback = name;
  t.nameReask = false;
}

function revert(next, prev) {
  next.caller.name = prev?.caller?.name || null;
  next.caller.nameConfirmed = Boolean(prev?.caller?.nameConfirmed);
  if (next.entities && !next.caller.name) delete next.entities.name;
}

// --------------------------------------------------------- prompt hints

const NEEDS_NAME_GOALS = /^(?:make_booking_request|place_order_or_request|request_callback|speak_to_human|leave_message|book|order|callback|human)/;

function askReason(state, language = 'en') {
  const g = String(state?.goal?.name || state?.goal?.type || state?.goal || state?.intent || '');
  const sw = /^(?:sw|sheng)/i.test(String(language || state?.language?.current || ''));
  if (/human|handover|escalat/.test(g)) return sw ? 'ili timu ikupigie' : 'so the team can call you back';
  if (/callback|message/.test(g)) return sw ? 'kwa ujumbe' : 'for the message';
  return sw ? 'kwa ajili ya booking' : 'for the booking';
}

/**
 * Overrides formatNameConfirmForPrompt under the flag. null = keep the legacy hint.
 */
function nameAskHint(state, { specificOnly = false } = {}) {
  if (!on() || !state) return null;
  const trustP1 = require('./trustP1');
  const t = state.trust || {};
  const lang = state?.language?.current || 'en';
  const sw = /^(?:sw|sheng)/i.test(String(lang));
  if (t.nameRefused) {
    return '- Caller declined to give a name. Say "No problem" once and carry on. Never ask for the name again. Saves go under the caller\'s phone number.';
  }
  if (state.caller?.nameConfirmed) {
    const n = state.caller.name;
    if (t.nameReadback === n && !t.nameReadbackSpoken) {
      return `- Caller name: ${n} (confirmed). Read it back once in your next sentence, e.g. "Thanks, ${n}." Do not ask for the name again.`;
    }
    if (specificOnly) return null;
    return `- Caller name: ${n} (confirmed). Do not ask for the name again. Say the name rarely (at most once more, at the close).`;
  }
  if (t.nameCandidate) {
    const n = t.nameCandidate.name;
    return sw
      ? `- Jina halijathibitishwa (${n}). Uliza mara moja: "Ni ${n}? Unaweza kuliandika herufi kwa herufi." Usitumie jina hili hadi athibitishe.`
      : `- Name not confirmed (${n}). Ask once: "Is that ${n}? You can spell it if that's easier." Do not use the name until they confirm.`;
  }
  const allowed = trustP1.nameAskAllowed(state);
  const goal = String(state?.goal?.name || state?.goal?.type || state?.goal || '');
  const missing = Array.isArray(state?.goal?.missingSlots) ? state.goal.missingSlots : [];
  const needs = missing.includes('name') && (NEEDS_NAME_GOALS.test(goal) || NEEDS_NAME_GOALS.test(String(state?.intent || '')) || missing.length <= 2);
  if (!allowed) return '- Do not ask for the caller\'s name (already asked enough). Carry on without it.';
  if (t.nameReask) {
    return sw ? '- Hukusikia jina vizuri. Uliza mara moja: "Samahani, sikusikia jina vizuri, unaitwa nani?"' : '- You did not catch the name. Ask once: "Sorry, I didn\'t catch your name. Could you say it again?"';
  }
  if (specificOnly) return null;
  if (!needs) return '- Do not ask for the caller\'s name now. Answer what they asked. Ask only when a booking, handover or message needs it.';
  const why = askReason(state, lang);
  return sw
    ? `- Jina linahitajika ${why}. Uliza mara moja kwa maneno haya: "Naomba jina lako tafadhali, ${why}?"`
    : `- The name is needed ${why}. Ask once, in these words: "Can I take your name ${why}?"`;
}

// ------------------------------------------------------- speaking names

const HONORIFIC = '(?:mr|mrs|ms|miss|madam|madame|sir|dr|mama|mzee|bwana|bi|mwalimu|pastor|auntie|aunty|uncle|cucu|shosho)';
const HONORIFIC_RE = new RegExp(`\\b${HONORIFIC}\\.?\\s+(?=\\p{Lu})`, 'giu');

/** The honorific the caller used for themselves ("Mama Njeri", "Mzee Kamau"), or ''. */
function callerHonorific(text) {
  const m = new RegExp(`\\b(?:i am|i'm|this is|it's|my name is|naitwa|ni|mimi ni|jina langu ni)\\s+(${HONORIFIC})\\.?\\s+\\p{L}`, 'iu').exec(String(text || ''));
  return m ? m[1].toLowerCase() : '';
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Guard the model's text: an unconfirmed name is never spoken (except inside
 * an identity-confirm question); a confirmed name at most NAME_SPEAK_MAX times;
 * honorifics only as the caller used them.
 */
function guardNameInSpeech(text, state) {
  if (!on() || !state) return { text, drops: [] };
  const drops = [];
  const t = trustState(state);
  let out = String(text || '');
  const confirmed = state.caller?.nameConfirmed === true ? String(state.caller.name || '').trim() : '';
  const unconfirmed = [state.caller?.name, state.trust?.nameCandidate?.name, state.caller?.fileNameAsked, state.returning?.fileOwnerName]
    .map((n) => String(n || '').trim())
    .filter((n) => n && (!confirmed || n.toLowerCase() !== confirmed.toLowerCase()));

  // Honorifics: keep only the caller's own form.
  const own = t.honorific || '';
  out = out.replace(HONORIFIC_RE, (m) => (own && m.trim().toLowerCase().replace(/\.$/, '') === own ? m : (drops.push('trust_honorific'), '')));

  const sentences = out.split(/(?<=[.!?])\s+/);
  const kept = [];
  for (let s of sentences) {
    const identityAsk = /\b(?:am i speaking with|is this|naongea na|ni wewe|is that|ni)\b[^.?!]*\?\s*$/i.test(s);
    for (const n of unconfirmed) {
      if (identityAsk) continue;
      const re = new RegExp(`(?:,\\s*)?\\b${escapeRe(n)}\\b(?:\\s*,)?`, 'gi');
      if (re.test(s)) {
        s = s.replace(re, '').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
        drops.push('trust_name_unconfirmed');
      }
    }
    if (confirmed) {
      const re = new RegExp(`\\b${escapeRe(confirmed)}\\b`, 'i');
      if (re.test(s)) {
        if (identityAsk) { kept.push(s); continue; }
        if ((t.nameSpoken || 0) >= NAME_SPEAK_MAX) {
          s = s.replace(new RegExp(`(?:,\\s*)?\\b${escapeRe(confirmed)}\\b(?:\\s*,)?`, 'gi'), '').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
          drops.push('trust_name_overuse');
        } else {
          t.nameSpoken = (t.nameSpoken || 0) + 1;
          if (t.nameReadback === confirmed) t.nameReadbackSpoken = true;
        }
      }
    }
    if (s && /\p{L}/u.test(s)) kept.push(s);
  }
  return { text: kept.join(' '), drops };
}

/** Track the caller's own honorific from their speech. */
function noteCallerTurn(state, text) {
  if (!on() || !state) return;
  const h = callerHonorific(text);
  if (h) trustState(state).honorific = h;
}

// ----------------------------------------------------- handover / SMS

/** A confirmed caller name, or "caller on 07xx…" from the phone. */
function handoverCallerLabel({ name, nameConfirmed, phone } = {}) {
  if (name && nameConfirmed) return String(name);
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.startsWith('254') ? `0${digits.slice(3)}` : digits;
  return local ? `caller on ${local}` : 'caller';
}

// ------------------------------------------------------------ TTS

/**
 * Strip apostrophes inside / at the end of names for TTS only ("Achieng'" →
 * "Achieng", "Ng'ang'a" → "Nganga"). English contractions and possessives stay.
 */
function stripNameApostrophes(text) {
  if (!on()) return text;
  let out = String(text || '');
  for (let i = 0; i < 4; i += 1) {
    const next = stripOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function stripOnce(text) {
  return String(text || '').replace(/(\p{L}+)['’](\p{L}*)/gu, (m, a, b) => {
    const tail = b.toLowerCase();
    if (/^(?:s|t|re|ve|ll|d|m)$/.test(tail)) return m; // don't, we're, I'll, Alvin's
    if (!b && /s$/i.test(a)) return m; // plural possessive "customers'"
    return a + b;
  });
}

module.exports = {
  BIND_MIN,
  CONFIRM_MIN,
  NAME_SPEAK_MAX,
  nameConfidence,
  parseSpelledName,
  isCommonWordName,
  isStaffMention,
  afterNameResolution,
  nameAskHint,
  guardNameInSpeech,
  callerHonorific,
  noteCallerTurn,
  handoverCallerLabel,
  stripNameApostrophes,
};
