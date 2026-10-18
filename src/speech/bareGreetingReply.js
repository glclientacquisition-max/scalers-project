'use strict';

// VOICE_BARE_GREETING_REPLY (default off).
//
// Prod, 7 days to 17 Oct 2026: 5 callers (4 Esga, 1 Aris) said a bare
// "Hello" / "Yes" after the greeting and heard nothing. Root cause on main
// 0340e46e: the cached-PCM greeting (VOICE_GREETING_CACHE on by default, and
// #645's greeting warm-up makes it the normal path) plays through
// playCachedFillerPcm, which sets lastAgentText but never feeds agentReplay.
// decideCallerEvent classifies "Hello" after "How can I help?" as hear_again
// with replay=true (it falls back to lastAgentText), server.js then asks
// agentReplay.pickReplay() for the line, gets '', speaks nothing and returns.
// "Yeah"/"Hello?" when the greeting has no "?" are soft backchannels and are
// ignored; the same words queued over the greeting are dropped by
// shouldSkipCallerTurn. Either way: silence.
//
// With the switch on, a bare greeting or affirmation before the caller's
// first real turn always gets a short re-invite in the caller's language.

const MAX_REINVITES = 3;

const EN_BARE = new Set([
  'hello', 'hallo', 'hullo', 'helo', 'hi', 'hey', 'hi there', 'hello there',
  'yes', 'yeah', 'yea', 'yep', 'yup', 'ya', 'okay', 'ok',
  'are you there', 'is anyone there', 'anyone there', 'can you hear me',
  'good morning', 'good afternoon', 'good evening',
  'hello hello', 'hello yes', 'yes hello', 'hi hello', 'hello hi',
]);

const SW_BARE = new Set([
  'halo', 'haloo', 'habari', 'habari yako', 'habari zako', 'habari gani',
  'hujambo', 'jambo', 'mambo', 'sasa', 'niaje', 'salama',
  'ndio', 'ndiyo', 'eeh', 'eh', 'ehe', 'eee', 'ee', 'eh eh', 'naam',
  'uko', 'uko hapo', 'uko wapi', 'unanisikia', 'halo halo', 'halo ndio',
  'ndio halo', 'sawa', 'poa',
]);

function bareGreetingReplyEnabled(env = process.env) {
  const raw = String(env.VOICE_BARE_GREETING_REPLY || '').trim().toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true' || raw === 'yes';
}

function normalizeBare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which bare opener this is: 'en', 'sw', or '' (not bare).
 * Repeats collapse ("Hello? Hello?" -> "hello").
 * @param {string} text
 */
function bareGreetingLanguage(text) {
  let t = normalizeBare(text);
  if (!t) return '';
  // "hello hello hello" -> "hello hello"; "yes yes" -> "yes"
  const words = t.split(' ');
  if (words.length > 1 && words.every((w) => w === words[0])) t = words[0];
  if (words.length > 4) return '';
  if (SW_BARE.has(t)) return 'sw';
  if (EN_BARE.has(t)) return 'en';
  return '';
}

function isBareGreetingOrAffirmation(text) {
  return Boolean(bareGreetingLanguage(text));
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Short spoken re-invite. Caller's own word decides the language when it is
 * Kiswahili; otherwise the call language; English by default. Neutral
 * words ("sawa", "ok") follow the call language.
 * @param {{ text?: string, callLanguage?: string, agentName?: string, businessName?: string, count?: number }} opts
 */
function bareGreetingReplyLine(opts = {}) {
  const heard = bareGreetingLanguage(opts.text);
  const neutral = /^(sawa|poa|ok|okay)$/.test(normalizeBare(opts.text));
  const callLang = String(opts.callLanguage || '').toLowerCase();
  const lang = heard === 'sw' && !neutral ? 'sw' : callLang === 'sw' ? 'sw' : 'en';
  const agent = cleanName(opts.agentName);
  const business = cleanName(opts.businessName);
  const count = Number(opts.count) || 0;
  const generic = /^(receptionist|assistant)$/i.test(agent);
  if (lang === 'sw') {
    if (count > 0) return 'Niko hapa. Nikusaidie aje?';
    if (agent && !generic && business) return `Sawa, mimi ni ${agent} wa ${business}. Nikusaidie aje?`;
    if (business) return `Sawa, hapa ni ${business}. Nikusaidie aje?`;
    return 'Sawa, nikusaidie aje?';
  }
  if (count > 0) return "Yes, I'm here. How can I help?";
  if (agent && !generic && business) return `Hi, this is ${agent} at ${business}. How can I help?`;
  if (business) return `Hi, this is ${business}. How can I help?`;
  return 'Hi, how can I help?';
}

/**
 * Decide whether this caller text gets a re-invite instead of the old path.
 * @param {{ text?: string, enabled?: boolean, firstRealTurnDone?: boolean, reinvites?: number, speaking?: boolean, turnBusy?: boolean, callEnding?: boolean }} s
 */
function shouldReinvite(s = {}) {
  const enabled = s.enabled != null ? Boolean(s.enabled) : bareGreetingReplyEnabled();
  if (!enabled) return false;
  if (s.callEnding) return false;
  if (s.firstRealTurnDone) return false;
  if (s.speaking || s.turnBusy) return false;
  if ((Number(s.reinvites) || 0) >= MAX_REINVITES) return false;
  return isBareGreetingOrAffirmation(s.text);
}

module.exports = {
  MAX_REINVITES,
  bareGreetingReplyEnabled,
  bareGreetingLanguage,
  isBareGreetingOrAffirmation,
  bareGreetingReplyLine,
  shouldReinvite,
};
