'use strict';

// One call opening for v1 and v2 (VOICE_OPENING_V2, OFF by default).
//
// Plan: briefs v2-greeting-and-path-plan.md B3 + C6, approved by Alvin
// 21 Oct 2026 13:18 EAT. The greeting runs before either brain, so both
// paths share it. This module owns, deterministically (no model, no
// randomness):
//   - the first greet, in the shop's language: the opening is translated, the
//     owner's ending (greeting_invite, or a future greeting_text) is kept word
//     for word, and the language invite is never spoken;
//   - returning callers: "Karibu tena" / "Welcome back", the name only when it
//     was confirmed on an earlier call. They hear the recording notice too
//     unless VOICE_RETURNING_SKIP_NOTICE=on (default off, KDPA-conservative);
//   - a recording notice cut by a barge is owed: one short notice line before
//     the first save or the first personal-details ask (createNoticeTracker);
//   - bare Hello before the first real turn (max 2 re-invites; folds in
//     VOICE_BARE_GREETING_REPLY);
//   - the silence ladder before the first real turn: 5 s after greeting
//     playout, then +10 s, then +10 s goodbye and hang-up (missed call);
//   - barge-in over the greeting: after 600 ms of caller speech, or at once
//     on a real word (not "mm" / "hello"); the greeting is never replayed;
//   - resume on a SautiKit reconnect: a session keyed by callSid outlives the
//     socket (DETACHED ~20 s). A second /ws/media for the same callSid plays
//     no greeting. A line cut mid-way is re-spoken; otherwise we listen;
//   - language: new callers switch on their first clear turn; mixed / Sheng
//     needs 2 consecutive turns; mid-call switches need 2 turns.
//
// Flag off: nothing here runs and server.js keeps today's opener exactly.

const {
  RECORDING_NOTICE_EN,
  RECORDING_NOTICE_SW,
  recordingNoticeOn,
} = require('../conversation/recordingNotice');
const {
  analyzeCallerLanguage,
  createLanguageState,
} = require('../conversation/language');
const {
  isDefaultAgentName,
  isDefaultShopName,
  spokenShopLabel,
  shortenNotice,
  greetingHelpLine,
} = require('../conversation/businessAssistantIntro');
const { isBareGreetingOrAffirmation, bareGreetingLanguage } = require('./bareGreetingReply');
const { createMemorySessionStore } = require('./openingSessionStore');

const FLAG = 'VOICE_OPENING_V2';
const RETURNING_SKIP_NOTICE_FLAG = 'VOICE_RETURNING_SKIP_NOTICE';
/** Notice counts as heard only this far past its estimated end in the clip. */
const NOTICE_HEARD_MARGIN_MS = 300;
const MAX_BARE_HELLO = 2;
const BARGE_MIN_SPEECH_MS = 600;
const DETACH_MS = 20000;
const SILENCE_LADDER_MS = Object.freeze([5000, 10000, 10000]);

const OLD_LANGUAGE_INVITE = /\b(you can speak in english or kiswahili|unaweza kuongea kwa kiingereza au kiswahili)\b/i;

/** Silence ladder steps (ms). VOICE_OPENING_SILENCE_MS="5000,10000,10000" overrides (tests, tuning). */
function silenceLadderMs(env = process.env) {
  const raw = String(env.VOICE_OPENING_SILENCE_MS || '').trim();
  if (!raw) return [...SILENCE_LADDER_MS];
  const steps = raw.split(',').map((v) => Number(v.trim()));
  if (steps.length !== 3 || steps.some((n) => !Number.isFinite(n) || n < 100 || n > 60000)) {
    return [...SILENCE_LADDER_MS];
  }
  return steps;
}

function openingV2Enabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env[FLAG] || '').trim());
}

/** VOICE_RETURNING_SKIP_NOTICE=on: returning callers skip the notice (default off: they hear it). */
function returningSkipNoticeOn(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env[RETURNING_SKIP_NOTICE_FLAG] || '').trim());
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function endSentence(text) {
  const t = clean(text);
  if (!t) return '';
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

function langOf(value) {
  return String(value || '').toLowerCase() === 'sw' ? 'sw' : 'en';
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const SW_OWNER_WORDS =
  /\b(\w*saidie|\w*hudumie|vipi|nini|gani|ngapi|wapi|lini|aje|karibu|tafadhali|asante|naitwa|hapa ni|tuko|mko|uko|sema|niambie|tuambie)\b/i;
const SW_QUESTION_END = /\b(vipi|nini|gani|ngapi|wapi|lini|aje|je)$/i;

/**
 * The shop's greeting language. A typed field wins (future Platform column
 * tenants.greeting_language); else the language of the owner's own words
 * (greeting_text, then greeting_invite); else English.
 * @param {{ greetingLanguage?: string, greetingText?: string, greetingInvite?: string }} profile
 * @returns {'en'|'sw'}
 */
function shopLanguage(profile = {}) {
  const typed = String(profile.greetingLanguage || profile.greeting_language || '').toLowerCase();
  if (typed === 'sw' || typed === 'en') return typed;
  for (const raw of [profile.greetingText || profile.greeting_text, profile.greetingInvite || profile.greeting_invite]) {
    const text = clean(raw);
    if (!text) continue;
    // Owner setup text is short ("Tukusaidie vipi"): the caller analyser has
    // no markers for it, so Swahili shop words decide first.
    if (SW_OWNER_WORDS.test(text)) return 'sw';
    const ev = analyzeCallerLanguage(text);
    if (ev.language === 'sw' || ev.language === 'sheng') return 'sw';
    if (ev.language === 'en') return 'en';
    if (ev.language === 'mixed') return ev.scores.sw >= ev.scores.en ? 'sw' : 'en';
  }
  return 'en';
}

/**
 * Returning-caller facts from the caller card (db.getCallerMemory).
 * name_confirmed is only true when a past call confirmed the name. Nothing
 * writes that today (Platform/Brain ask), so the name is not spoken yet.
 * @param {object|null} card profile.callerMemory
 */
function callerOpeningFacts(card) {
  if (!card || typeof card !== 'object') {
    return { isReturning: false, knownName: '', nameConfirmed: false, lastLanguage: null };
  }
  const knownName = clean(card.fileOwnerName || card.name);
  const nameConfirmed =
    Boolean(knownName) &&
    card.sharedLine !== true &&
    (card.nameConfirmed === true || card.name_confirmed === true);
  // contacts.last_language (#844): en | sw, null when never saved.
  const ll = String(card.lastLanguage || card.last_language || '').toLowerCase();
  const lastLanguage = ll === 'en' || ll === 'sw' ? ll : null;
  return { isReturning: true, knownName, nameConfirmed, lastLanguage };
}

/**
 * The greeting language: a returning caller's last settled language
 * (contacts.last_language), else the shop's language.
 * @returns {{ language: 'en'|'sw', shopLanguage: 'en'|'sw', source: 'caller_last'|'shop' }}
 */
function openingLanguageFor(profile = {}, facts = {}) {
  const shop = shopLanguage(profile);
  if (facts && facts.isReturning && (facts.lastLanguage === 'en' || facts.lastLanguage === 'sw')) {
    return { language: facts.lastLanguage, shopLanguage: shop, source: facts.lastLanguage === shop ? 'shop' : 'caller_last' };
  }
  return { language: shop, shopLanguage: shop, source: 'shop' };
}

function staffNames(profile = {}) {
  const team = Array.isArray(profile.teamDirectory)
    ? profile.teamDirectory
    : Array.isArray(profile.team_directory)
      ? profile.team_directory
      : [];
  return team.map((m) => clean(m && m.name)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Templates (deterministic)
// ---------------------------------------------------------------------------

const PACK = {
  en: {
    identity: (shop, agent) => (agent ? `${shop}, this is ${agent}.` : `${shop}.`),
    welcomeBack: (name) => (name ? `Welcome back, ${name}.` : 'Welcome back.'),
    notice: RECORDING_NOTICE_EN,
    closedServe: "We're closed right now, but I can still take your request.",
    closedMessage: "We're closed right now. I can take a message.",
    messageOnly: 'I can take a message.',
    nameAsk: 'May I have your name?',
    invite: 'How can I help?',
    bare: ["Yes, I'm here.", 'I can hear you.'],
    silence: ['', 'Hello?'],
    goodbye: "I can't hear you, so I'll end the call now. Please call back anytime. Goodbye.",
  },
  sw: {
    identity: (shop, agent) => (agent ? `Hapa ni ${shop}, naitwa ${agent}.` : `Hapa ni ${shop}.`),
    welcomeBack: (name) => (name ? `Karibu tena, ${name}.` : 'Karibu tena.'),
    notice: RECORDING_NOTICE_SW,
    closedServe: 'Tumefunga kwa sasa, lakini bado naweza kuchukua ombi lako.',
    closedMessage: 'Tumefunga kwa sasa. Naweza kuchukua ujumbe.',
    messageOnly: 'Naweza kuchukua ujumbe.',
    nameAsk: 'Naomba jina lako?',
    invite: 'Nikusaidie vipi?',
    bare: ['Ndiyo, niko hapa.', 'Nakusikia.'],
    silence: ['', 'Halo?'],
    goodbye: 'Sikusikii, kwa hivyo nitakata simu sasa. Karibu upige tena wakati wowote. Kwaheri.',
  },
};

/**
 * The owner's closing question, kept word for word (only end punctuation and
 * a capital are added, as today). Empty or the stock English question falls
 * back to the shop-language default.
 */
function openingInvite({ greetingInvite, language }) {
  const lang = langOf(language);
  const raw = clean(greetingInvite);
  const bare = raw.replace(/[.!?…]+$/g, '').trim();
  if (!raw || /^how can i help$/i.test(bare)) return PACK[lang].invite;
  // Owner words are kept; only a missing end mark is added. A Swahili
  // question ("Tukusaidie vipi") gets "?", not ".".
  if (!/[.!?…]$/.test(raw) && SW_QUESTION_END.test(raw)) {
    return `${raw.charAt(0).toUpperCase()}${raw.slice(1)}?`;
  }
  return greetingHelpLine({ greetingInvite: raw });
}

function shopLabel({ spokenName, businessName }) {
  return spokenShopLabel({ spokenName }) || clean(businessName);
}

/**
 * Compose the opening line.
 * @param {{
 *   businessName?: string, spokenName?: string, agentName?: string,
 *   greetingText?: string, greetingInvite?: string, language?: 'en'|'sw',
 *   isOpen?: boolean|null, afterHoursMode?: string, closureNotice?: string,
 *   recordingNotice?: boolean, isReturning?: boolean, knownName?: string,
 *   nameConfirmed?: boolean,
 * }} o
 *   returningSkipNotice?: boolean (default VOICE_RETURNING_SKIP_NOTICE),
 * @returns {{ text: string, kind: string, language: 'en'|'sw', invite: string, notice: boolean, noticeText: string, noticeEnd: number|null }}
 *   noticeEnd: character offset just past the notice in text (null: no notice).
 */
function composeOpening(o = {}) {
  const lang = langOf(o.language);
  const p = PACK[lang];
  const shop = shopLabel(o);
  const agentRaw = clean(o.agentName);
  const agent = isDefaultAgentName(agentRaw) ? '' : agentRaw;
  // The owner's words (greeting_text, greeting_invite) are in the shop's
  // language; greeting a returning caller in their own language uses the
  // template and the default question instead.
  const ownerLang = o.shopLanguage === 'en' || o.shopLanguage === 'sw' ? o.shopLanguage : lang;
  const ownerWordsFit = ownerLang === lang;
  const invite = ownerWordsFit
    ? openingInvite({ greetingInvite: o.greetingInvite, language: lang })
    : PACK[lang].invite;
  const messageMode = String(o.afterHoursMode || 'serve').toLowerCase() === 'message';
  const closed = o.isOpen === false;
  const closure = shortenNotice(o.closureNotice);
  const returning = o.isReturning === true;
  const recording = o.recordingNotice != null ? Boolean(o.recordingNotice) : recordingNoticeOn();
  const skipForReturning =
    o.returningSkipNotice != null ? Boolean(o.returningSkipNotice) : returningSkipNoticeOn();
  const noticeOn = recording && !(returning && skipForReturning);
  const name = returning && o.nameConfirmed === true ? clean(o.knownName) : '';

  const parts = [];
  const owner = ownerWordsFit ? clean(o.greetingText) : '';
  if (owner && !returning) {
    // Owner's full greeting, verbatim (future tenants.greeting_text).
    parts.push(endSentence(owner));
  } else {
    parts.push(p.identity(shop, agent));
  }
  if (returning) parts.push(p.welcomeBack(name));
  const ownerSaysRecord = Boolean(owner) && /\b(record|rekodi)/i.test(owner);
  if (noticeOn && !ownerSaysRecord) parts.push(p.notice);
  let follow = invite;
  if (closure) {
    parts.push(endSentence(closure)); // owner's words, verbatim
    follow = messageMode ? p.nameAsk : invite;
  } else if (closed) {
    parts.push(messageMode ? p.closedMessage : p.closedServe);
    follow = messageMode ? p.nameAsk : invite;
  } else if (messageMode) {
    parts.push(p.messageOnly);
    follow = p.nameAsk;
  }
  // The owner's own greeting already ends with their question; only a
  // message-mode name ask is added after it.
  const ownerUsed = Boolean(owner) && !returning;
  if (!ownerUsed || follow === p.nameAsk) parts.push(follow);
  const kind = [
    returning ? (name ? 'returning_named' : 'returning') : 'new',
    closure ? 'bulletin' : closed ? (messageMode ? 'closed_message' : 'closed_serve') : messageMode ? 'message' : 'open',
  ].join('_');
  const text = parts.filter(Boolean).join(' ');
  // Where the notice ends in the line, so a barge can tell whether it was heard.
  let noticeText = '';
  if (noticeOn) noticeText = ownerSaysRecord ? owner : p.notice;
  const at = noticeText ? text.indexOf(noticeText) : -1;
  return {
    text,
    kind,
    language: lang,
    invite,
    notice: noticeOn,
    noticeText,
    noticeEnd: at >= 0 ? at + noticeText.length : null,
  };
}

function bareHelloLine({ language, invite, count = 0 }) {
  const p = PACK[langOf(language)];
  const lead = p.bare[Math.min(Math.max(0, count), p.bare.length - 1)];
  return `${lead} ${invite || p.invite}`;
}

/** step 1..3. Step 3 is the goodbye. */
function silenceLine({ language, invite, step }) {
  const p = PACK[langOf(language)];
  if (step >= 3) return p.goodbye;
  const lead = p.silence[step - 1] || '';
  return clean(`${lead} ${invite || p.invite}`);
}

/**
 * Banned-content and identity check for any opening line.
 * @returns {{ ok: boolean, problems: string[] }}
 */
function checkOpeningLine(line, { shopName, staff = [], agentName } = {}) {
  const text = clean(line);
  const lower = text.toLowerCase();
  const problems = [];
  if (!text) problems.push('empty');
  if (OLD_LANGUAGE_INVITE.test(text)) problems.push('language_invite');
  const shop = clean(shopName);
  if (shop && !isDefaultShopName(shop) && !lower.includes(shop.toLowerCase())) problems.push('shop_name_missing');
  if (/\bthe business\b/i.test(text) && !/\bthe business\b/i.test(shop)) problems.push('default_shop_name');
  const agent = clean(agentName).toLowerCase();
  for (const s of staff) {
    const n = clean(s);
    if (!n || n.toLowerCase() === agent) continue;
    const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) problems.push(`staff_name:${n}`);
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Barge-in over the greeting
// ---------------------------------------------------------------------------

const NON_WORDS = new Set([
  'mm', 'mmm', 'mhm', 'hmm', 'hm', 'uh', 'um', 'er', 'ah', 'eh', 'ehe', 'oh', 'aha',
  'uh huh', 'mm hmm', 'ok', 'okay', 'sawa', 'yeah', 'yes', 'ndio', 'ndiyo', 'eeh', 'ee',
]);

function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A real word: not a filler, not a bare greeting/backchannel. */
function hasRealWord(text) {
  const t = normalizeWords(text);
  if (!t) return false;
  if (NON_WORDS.has(t) || isBareGreetingOrAffirmation(t)) return false;
  return t.split(' ').some((w) => w.length >= 2 && !NON_WORDS.has(w) && !bareGreetingLanguage(w));
}

/** Caller speech span from STT tokens (ms of audio clock). */
function speechSpanMs(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  let start = Infinity;
  let end = -Infinity;
  for (const t of list) {
    const s = Number(t && t.start_ms);
    const e = Number(t && t.end_ms);
    if (Number.isFinite(s)) start = Math.min(start, s);
    if (Number.isFinite(e)) end = Math.max(end, e);
  }
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
}

/**
 * Should caller speech over the greeting stop it?
 * @returns {{ barge: boolean, reason: string }}
 */
function decideGreetingBarge({ text, speechMs = 0, minMs = BARGE_MIN_SPEECH_MS } = {}) {
  if (hasRealWord(text)) return { barge: true, reason: 'real_word' };
  if (Number(speechMs) >= minMs && normalizeWords(text)) return { barge: true, reason: 'speech_ms' };
  return { barge: false, reason: 'hold' };
}

// ---------------------------------------------------------------------------
// Language policy
// ---------------------------------------------------------------------------

/**
 * One language policy for the opening and the call.
 *  - The call starts in the shop language.
 *  - The caller's first real turn switches at once when it is clearly the
 *    other language (en/sw, confidence >= 0.7).
 *  - Mixed or Sheng speech never switches at once; 2 consecutive turns that
 *    lean the same other way do. Mid-call, any switch needs 2 turns.
 * Output keeps the createLanguageState() shape.
 */
function resolveOpeningLanguage(previous, evidence, { firstTurn = false, shopLanguage: shopLang = 'en' } = {}) {
  const state = { ...createLanguageState(), ...(previous || {}) };
  if (state.current !== 'en' && state.current !== 'sw') state.current = langOf(shopLang);
  const detected = evidence?.language || 'unknown';
  const confidence = Number(evidence?.confidence || 0);
  const scores = evidence?.scores || {};
  state.detected = detected;
  let lean = '';
  let clear = false;
  if (detected === 'en' || detected === 'sw') {
    lean = detected;
    clear = confidence >= 0.7;
  } else if (detected === 'mixed') {
    const sw = Number(scores.sw || 0);
    const en = Number(scores.en || 0);
    lean = sw > en ? 'sw' : en > sw ? 'en' : '';
  } else if (detected === 'sheng') {
    lean = 'sw';
  }
  if (!lean || lean === state.current) {
    state.pending = null;
    state.pendingCount = 0;
    if (lean === state.current) state.confidence = Math.max(Number(state.confidence || 0), confidence);
    return state;
  }
  if (firstTurn && clear) {
    state.current = lean;
    state.confidence = confidence;
    state.switchCount = Number(state.switchCount || 0) + 1;
    state.pending = null;
    state.pendingCount = 0;
    return state;
  }
  const count = state.pending === lean ? Number(state.pendingCount || 0) + 1 : 1;
  if (count >= 2) {
    state.current = lean;
    state.confidence = confidence;
    state.switchCount = Number(state.switchCount || 0) + 1;
    state.pending = null;
    state.pendingCount = 0;
    return state;
  }
  state.pending = lean;
  state.pendingCount = count;
  return state;
}

function initialLanguageState(shopLang) {
  return { ...createLanguageState(), current: langOf(shopLang), confidence: 0.5 };
}

// ---------------------------------------------------------------------------
// Session per callSid (outlives the socket)
// ---------------------------------------------------------------------------
//
// CONNECTED --first stream--> OPENING
// OPENING --barge--> TURN (greeted, never replayed)
// OPENING --done--> AWAIT_FIRST
// AWAIT_FIRST --bare hello (<=2)--> AWAIT_FIRST
// AWAIT_FIRST --silence ladder--> AWAIT_FIRST | END
// AWAIT_FIRST --real turn--> TURN
// any --socket closes, call not ended--> DETACHED (<= 20 s)
// DETACHED --new stream, same callSid--> RESUME --> previous state
// DETACHED --timeout / ended--> END

const STATES = Object.freeze({
  CONNECTED: 'CONNECTED',
  OPENING: 'OPENING',
  AWAIT_FIRST: 'AWAIT_FIRST',
  TURN: 'TURN',
  DETACHED: 'DETACHED',
  END: 'END',
});

function createOpeningSession(callSid, { now = Date.now() } = {}) {
  return {
    callSid: String(callSid || ''),
    state: STATES.CONNECTED,
    streamSeq: 0,
    greetedAt: null,
    greetingText: '',
    greetingEndAt: null,
    greetingBarged: false,
    lastAgentLine: '',
    lastLineCut: false,
    firstRealTurnDone: false,
    bareCount: 0,
    silenceStep: 0,
    resumeState: null,
    detachedAt: null,
    createdAt: now,
    carry: null,
    // Recording notice (createNoticeTracker snapshot) and A/B variant.
    notice: null,
    noticeVariant: null,
    resumedFrom: null,
  };
}

/** Rebuild a DETACHED session on this replica from the shared calls row. */
function sessionFromShared(callSid, rec, { now = Date.now() } = {}) {
  const s = createOpeningSession(callSid, { now });
  s.greetedAt = rec.greetedAt;
  s.lastAgentLine = clean(rec.lastAgentLine);
  // The row does not say whether the line was cut; listen (a bare Hello
  // still gets the re-invite) rather than repeat a line that was heard.
  s.lastLineCut = false;
  s.streamSeq = Number(rec.streamSeq) || 1;
  s.notice = rec.noticeGiven ? { required: true, given: true, state: 'given', how: 'earlier_stream', at_ms: null, cut_at_ms: null } : null;
  s.resumeState = STATES.AWAIT_FIRST;
  s.state = STATES.DETACHED;
  s.detachedAt = now;
  s.resumedFrom = 'shared';
  return s;
}

/**
 * In-memory greeted_at mirror. A DB mirror on calls needs a Platform column
 * (calls.greeted_at, calls.last_agent_line); keep this interface so it can be
 * swapped without touching server.js.
 */
function createMemoryGreetedMirror() {
  const rows = new Map();
  return {
    write(callSid, patch) {
      rows.set(String(callSid), { ...(rows.get(String(callSid)) || {}), ...patch });
      return Promise.resolve(true);
    },
    read(callSid) {
      return Promise.resolve(rows.get(String(callSid)) || null);
    },
    delete(callSid) {
      rows.delete(String(callSid));
    },
  };
}

/**
 * @param {{ detachMs?: number, setTimeout?: Function, clearTimeout?: Function, mirror?: object, now?: () => number }} [opts]
 */
function createOpeningStore(opts = {}) {
  const detachMs = Number.isFinite(opts.detachMs) ? opts.detachMs : DETACH_MS;
  const schedule = opts.setTimeout || setTimeout;
  const cancel = opts.clearTimeout || clearTimeout;
  const now = opts.now || (() => Date.now());
  // Shared resume state (openingSessionStore: memory or Supabase calls row).
  const shared = opts.shared || createMemorySessionStore({ now });
  const sharedTimeoutMs = Number.isFinite(opts.sharedTimeoutMs) ? opts.sharedTimeoutMs : 800;
  const mirror = opts.mirror || createMemoryGreetedMirror();
  const sessions = new Map();
  const timers = new Map();

  function drop(sid) {
    const t = timers.get(sid);
    if (t != null) cancel(t);
    timers.delete(sid);
    sessions.delete(sid);
    if (mirror.delete) mirror.delete(sid);
  }

  /**
   * A media socket opened for callSid.
   * @returns {{ session: object, resumed: boolean, action: 'greet'|'respeak'|'listen'|'reinvite' }}
   */
  function attach(callSid) {
    const sid = String(callSid || '');
    let s = sid ? sessions.get(sid) : null;
    if (s && s.state === STATES.END) s = null;
    if (!s) {
      s = createOpeningSession(sid, { now: now() });
      s.streamSeq = 1;
      s.state = STATES.OPENING;
      if (sid) sessions.set(sid, s);
      return { session: s, resumed: false, action: 'greet' };
    }
    const t = timers.get(sid);
    if (t != null) cancel(t);
    timers.delete(sid);
    s.streamSeq += 1;
    s.detachedAt = null;
    const prev = s.resumeState || STATES.AWAIT_FIRST;
    s.resumeState = null;
    if (s.greetedAt == null) {
      // Socket died before any greeting audio: this is still the first greet.
      s.state = STATES.OPENING;
      return { session: s, resumed: true, action: 'greet' };
    }
    let action = 'listen';
    if (s.lastLineCut && s.lastAgentLine) {
      action = s.lastAgentLine === s.greetingText ? 'reinvite' : 'respeak';
    }
    s.state = prev === STATES.OPENING ? STATES.AWAIT_FIRST : prev;
    return { session: s, resumed: true, action };
  }

  /**
   * attach() for a socket. A local session (same replica) resumes at once.
   * Otherwise the session is new and, unless the incoming-call webhook ran
   * here (fresh), must win the shared greeting claim before it greets
   * (claimGreeting); a reconnect on another replica loses it and resumes.
   * @returns {Promise<{ session, resumed, action, source: 'local'|'new', needsClaim: boolean }>}
   */
  async function attachShared(callSid, { fresh = false } = {}) {
    const sid = String(callSid || '');
    const local = sid && sessions.has(sid);
    const r = attach(sid);
    void shared.bumpStream(sid).then((seq) => {
      if (Number.isFinite(seq) && r.session) r.session.sharedStreamSeq = seq;
    }).catch(() => {});
    return { ...r, source: local ? 'local' : 'new', needsClaim: Boolean(sid) && !local && !fresh };
  }

  /**
   * Claim the greeting for this call across replicas (markCallGreeted). won
   * true: greet. won false: another stream already greeted; the session is
   * rebuilt from the row and resumes. won null (error, timeout, no row):
   * fail open and greet, as today.
   * @returns {Promise<{ won: boolean|null, attach?: object }>}
   */
  async function claimGreeting(callSid, { line = '', timeoutMs = sharedTimeoutMs } = {}) {
    const sid = String(callSid || '');
    if (!sid) return { won: null };
    const timeout = (v) =>
      new Promise((resolve) => {
        const t = schedule(() => resolve(v), timeoutMs);
        if (t && typeof t.unref === 'function') t.unref();
      });
    let c;
    try {
      c = await Promise.race([shared.claim(sid, { lastAgentLine: line }), timeout({ won: null, timeout: true })]);
    } catch {
      c = { won: null };
    }
    if (c.won !== false) return { won: c.won, timeout: Boolean(c.timeout) };
    let rec = null;
    try {
      rec = await Promise.race([shared.get(sid), timeout(null)]);
    } catch {
      rec = null;
    }
    const s = sessionFromShared(sid, { greetedAt: c.greetedAt, ...(rec || {}) }, { now: now() });
    const cur = sessions.get(sid);
    sessions.set(sid, s);
    const a = attach(sid);
    // stream_seq: this stream's own bump when it has answered, else the row's
    // count plus this stream.
    if (cur && Number.isFinite(cur.sharedStreamSeq)) a.session.streamSeq = cur.sharedStreamSeq;
    return { won: false, attach: { ...a, source: 'shared', needsClaim: false } };
  }

  /** Recording notice heard: keep it for a reconnect elsewhere. */
  function noteNoticeGiven(session) {
    if (session && session.callSid) void shared.markNoticeGiven(session.callSid).catch(() => {});
  }

  /**
   * The socket closed.
   * @param {{ ended?: boolean, speaking?: boolean, line?: string, carry?: object }} info
   */
  function detach(callSid, info = {}) {
    const sid = String(callSid || '');
    const s = sessions.get(sid);
    if (!s) return null;
    if (info.ended) {
      s.state = STATES.END;
      drop(sid);
      return { ended: true };
    }
    s.resumeState = s.state === STATES.DETACHED ? s.resumeState : s.state;
    s.state = STATES.DETACHED;
    s.detachedAt = now();
    s.lastLineCut = Boolean(info.speaking && clean(info.line || s.lastAgentLine));
    if (info.line) s.lastAgentLine = clean(info.line);
    if (info.carry) s.carry = info.carry;
    if (s.lastLineCut && s.lastAgentLine) void shared.noteLine(sid, s.lastAgentLine).catch(() => {});
    const t = schedule(() => {
      timers.delete(sid);
      const cur = sessions.get(sid);
      if (cur && cur.state === STATES.DETACHED) {
        cur.state = STATES.END;
        drop(sid);
      }
    }, detachMs);
    if (t && typeof t.unref === 'function') t.unref();
    timers.set(sid, t);
    return { ended: false, detachMs };
  }

  function noteGreeted(session, { text, at = now() } = {}) {
    if (session.greetedAt == null) session.greetedAt = at;
    session.greetingText = clean(text) || session.greetingText;
    session.lastAgentLine = session.greetingText;
    if (session.callSid) {
      void mirror.write(session.callSid, { greeted_at: new Date(session.greetedAt).toISOString() });
    }
  }

  function noteLine(session, line) {
    const t = clean(line);
    if (!t) return;
    session.lastAgentLine = t;
    if (session.callSid) void mirror.write(session.callSid, { last_agent_line: t });
    if (session.callSid) void shared.noteLine(session.callSid, t).catch(() => {});
  }

  return {
    attach,
    attachShared,
    claimGreeting,
    noteNoticeGiven,
    shared,
    detach,
    noteGreeted,
    noteLine,
    get: (sid) => sessions.get(String(sid || '')) || null,
    size: () => sessions.size,
    mirror,
    reset() {
      for (const sid of [...sessions.keys()]) drop(sid);
    },
  };
}

// ---------------------------------------------------------------------------
// Recording notice owed after a barge (KDPA, conservative)
// ---------------------------------------------------------------------------

/** The short notice line spoken when the greeting's notice was cut. */
function noticeLine(language) {
  return PACK[langOf(language)].notice;
}

const PERSONAL_NAME_ASK =
  /\b(?:may i have your name|what(?:'s| is) your (?:full )?name|tell me your name|(?:could|can) i (?:have|get|take) your name|who am i speaking (?:with|to)|am i speaking with|your name,? please|name, please|jina lako|niambie jina|unaitwa nani|naomba jina|naongea na nani|naongea na)\b/i;
const PERSONAL_PHONE_ASK =
  /\b(?:your (?:phone |mobile |best |contact )?number|(?:phone|mobile|contact) number|number (?:to|we can) (?:reach|call)|namba yako|nambari yako|namba ya simu|nambari ya simu)\b/i;
const PERSONAL_PLACE_ASK =
  /\b(?:where are you(?: located| based| calling from)?\b|your (?:location|address|area|estate)|which (?:area|estate|location|town)|what (?:area|estate|location|address)|uko wapi|unaishi wapi|mko wapi|unapatikana wapi|eneo (?:gani|lako)|mtaa (?:gani|wako)|location yako|address yako|anwani yako|nyumba yako iko wapi|tukuje wapi|tuje wapi)\b/i;

/**
 * Does an agent line ask the caller for personal details (name, phone,
 * address or location)? Used only to deliver an owed recording notice first.
 * @returns {false|'name'|'phone'|'location'}
 */
function isPersonalDetailsAsk(text) {
  const t = clean(text);
  if (!t) return false;
  if (PERSONAL_NAME_ASK.test(t)) return 'name';
  if (PERSONAL_PHONE_ASK.test(t)) return 'phone';
  if (PERSONAL_PLACE_ASK.test(t)) return 'location';
  return false;
}

/**
 * Per-call recording notice state.
 *   not_required: no notice this call (not recording, or returning + skip flag)
 *   pending:      in the greeting, not yet past it
 *   given:        heard (greeting, before_ask, before_save, resume)
 *   owed:         a barge or a drop cut it; deliver one short line before the
 *                 first save or personal-details ask, whichever comes first
 * @param {{ required: boolean, now?: () => number, startedAt?: number }} o
 */
function createNoticeTracker(o = {}) {
  const now = o.now || (() => Date.now());
  const startedAt = Number.isFinite(o.startedAt) ? o.startedAt : now();
  const st = {
    state: o.required ? 'pending' : 'not_required',
    how: o.required ? '' : 'not_required',
    atMs: null,
    cutAt: null,
  };
  const t = {
    get state() {
      return st.state;
    },
    owed: () => st.state === 'owed',
    /** Greeting audio ran to the end (or past the notice). */
    heardInGreeting() {
      if (st.state !== 'pending') return false;
      st.state = 'given';
      st.how = 'greeting';
      st.atMs = now() - startedAt;
      return true;
    },
    /**
     * Greeting barged after playedMs of its audio. noticeEndMs is where the
     * notice ends in the clip (null: unknown, e.g. live TTS: assume cut).
     */
    greetingCut({ playedMs = null, noticeEndMs = null } = {}) {
      if (st.state !== 'pending') return st.state;
      const heard =
        Number.isFinite(playedMs) && Number.isFinite(noticeEndMs) && playedMs >= noticeEndMs + NOTICE_HEARD_MARGIN_MS;
      if (heard) return t.heardInGreeting() && 'given';
      st.state = 'owed';
      st.cutAt = now() - startedAt;
      return 'owed';
    },
    /** A reconnect before the notice was heard: still owed. */
    resumeFromPending() {
      if (st.state === 'pending') {
        st.state = 'owed';
        st.cutAt = now() - startedAt;
      }
    },
    /** The owed line was spoken (how: before_ask | before_save | ...). */
    given(how) {
      if (st.state !== 'owed' && st.state !== 'pending') return false;
      st.state = 'given';
      st.how = String(how || 'line');
      st.atMs = now() - startedAt;
      return true;
    },
    /** For logs, the trace and the shared session store. */
    snapshot() {
      return {
        required: st.state !== 'not_required',
        given: st.state === 'given',
        state: st.state,
        how: st.how || (st.state === 'owed' ? 'owed' : st.state),
        at_ms: st.atMs,
        cut_at_ms: st.cutAt,
      };
    },
    restore(snap) {
      if (!snap || typeof snap !== 'object' || !snap.state) return;
      st.state = snap.state === 'pending' ? 'owed' : snap.state;
      st.how = snap.how || st.how;
      st.atMs = snap.at_ms ?? null;
      st.cutAt = snap.cut_at_ms ?? null;
    },
  };
  return t;
}

/** Where the notice ends in a cached clip of durationMs (proportional to text). */
function noticeEndMsIn({ text, noticeEnd, durationMs }) {
  const len = clean(text).length;
  if (!len || noticeEnd == null || !Number.isFinite(durationMs)) return null;
  return Math.round((durationMs * Math.min(noticeEnd, len)) / len);
}

// Session transitions (pure; the server does the audio).

function onGreetingBarge(session) {
  session.greetingBarged = true;
  session.state = STATES.TURN;
}

function onGreetingDone(session, { at = Date.now() } = {}) {
  session.greetingEndAt = at;
  if (session.state === STATES.OPENING) session.state = STATES.AWAIT_FIRST;
}

/**
 * A caller final before the first real turn.
 * @returns {{ reinvite: boolean, count: number }}
 */
function onBareHello(session, text) {
  if (session.firstRealTurnDone || !isBareGreetingOrAffirmation(text)) {
    return { reinvite: false, count: session.bareCount };
  }
  if (session.bareCount >= MAX_BARE_HELLO) return { reinvite: false, count: session.bareCount };
  session.bareCount += 1;
  session.silenceStep = 0;
  return { reinvite: true, count: session.bareCount };
}

function onRealTurn(session) {
  session.firstRealTurnDone = true;
  session.silenceStep = 0;
  session.state = STATES.TURN;
}

/**
 * Silence ladder before the first real turn. Arm after greeting (or
 * re-invite) playout; any caller speech clears it.
 * @param {{ canFire: () => boolean, speak: (step: number) => unknown, delays?: number[], setTimeout?: Function, clearTimeout?: Function }} opts
 */
function createSilenceLadder(opts = {}) {
  const delays = Array.isArray(opts.delays) ? opts.delays : SILENCE_LADDER_MS;
  const schedule = opts.setTimeout || setTimeout;
  const cancel = opts.clearTimeout || clearTimeout;
  let timer = null;
  let step = 0;
  let closed = false;
  function clear() {
    if (timer != null) cancel(timer);
    timer = null;
  }
  function fire() {
    timer = null;
    if (closed) return;
    if (typeof opts.canFire === 'function' && !opts.canFire()) {
      // Busy (speaking, a turn, a queued utterance): look again shortly.
      timer = schedule(fire, 1000);
      if (timer && typeof timer.unref === 'function') timer.unref();
      return;
    }
    step += 1;
    const done = step >= delays.length;
    Promise.resolve()
      .then(() => opts.speak(step))
      .catch(() => {})
      .then(() => {
        if (done) closed = true;
      });
  }
  return {
    /** Arm the next step (from playout end). */
    arm() {
      clear();
      if (closed || step >= delays.length) return false;
      timer = schedule(fire, delays[step]);
      if (timer && typeof timer.unref === 'function') timer.unref();
      return true;
    },
    /** Caller spoke: restart the ladder from step 1 next time it is armed. */
    reset() {
      clear();
      step = 0;
    },
    clear,
    close() {
      closed = true;
      clear();
    },
    step: () => step,
    armed: () => timer != null,
    closed: () => closed,
  };
}

/** Lines the warmer should pre-render for a tenant (cache hits on the call). */
function openingWarmLines(profile = {}, { isOpen = null, recordingNotice } = {}) {
  const language = shopLanguage(profile);
  const base = {
    businessName: profile.businessName,
    spokenName: profile.spokenName,
    agentName: profile.agentName,
    greetingText: profile.greetingText,
    greetingInvite: profile.greetingInvite,
    language,
    isOpen,
    afterHoursMode: profile.afterHoursMode,
    closureNotice: profile.closureNotice,
    recordingNotice,
  };
  const first = composeOpening(base);
  const back = composeOpening({ ...base, isReturning: true });
  const lines = [first.text, back.text];
  for (let i = 0; i < MAX_BARE_HELLO; i += 1) lines.push(bareHelloLine({ language, invite: first.invite, count: i }));
  for (let s = 1; s <= SILENCE_LADDER_MS.length; s += 1) lines.push(silenceLine({ language, invite: first.invite, step: s }));
  return [...new Set(lines.filter(Boolean))];
}

module.exports = {
  FLAG,
  RETURNING_SKIP_NOTICE_FLAG,
  NOTICE_HEARD_MARGIN_MS,
  returningSkipNoticeOn,
  noticeLine,
  isPersonalDetailsAsk,
  createNoticeTracker,
  noticeEndMsIn,
  MAX_BARE_HELLO,
  BARGE_MIN_SPEECH_MS,
  DETACH_MS,
  SILENCE_LADDER_MS,
  STATES,
  PACK,
  openingV2Enabled,
  silenceLadderMs,
  shopLabel,
  shopLanguage,
  openingLanguageFor,
  callerOpeningFacts,
  staffNames,
  openingInvite,
  composeOpening,
  bareHelloLine,
  silenceLine,
  checkOpeningLine,
  hasRealWord,
  speechSpanMs,
  decideGreetingBarge,
  resolveOpeningLanguage,
  initialLanguageState,
  createOpeningSession,
  createOpeningStore,
  sessionFromShared,
  createMemoryGreetedMirror,
  onGreetingBarge,
  onGreetingDone,
  onBareHello,
  onRealTurn,
  createSilenceLadder,
  openingWarmLines,
};
