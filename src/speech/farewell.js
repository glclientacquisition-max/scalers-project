// A spoken goodbye ends the call.
//
// HD_b82fbfef7649 (2026-10-09 20:12 EAT): the agent said "You are welcome,
// Alvin. Have a great day!", the caller said "Haya.", the agent said a second
// goodbye ("Sawa Alvin, uwe na siku njema!"), then 7 s later the idle nudge
// "Naweza kusaidia?" and STT 408s until the line dropped. Nothing hung up:
// the tenant's end_call toggle was off, so the model could not emit
// ###ENDCALL###, and nothing else treated a goodbye as the end.
//
// Detection is deliberately narrow: the LAST sentence of a committed agent
// line must be a closing phrase and must not be a question. A bare "asante"
// / "thank you" / "karibu" mid-call is not a goodbye.

const SENTENCE_SPLIT = /(?<=[.!?…])\s+/u;

const CLOSING = [
  // English
  /\b(good\s?-?bye|bye(?:[\s-]bye)?)\b/i,
  /\bhave an? (?:great|good|nice|lovely|wonderful|blessed|fantastic|safe) (?:day|evening|night|afternoon|morning|weekend|one|time|trip)\b/i,
  /\b(?:take care|talk (?:to you )?soon|speak (?:to you )?soon|see you(?: soon| then)?)\b/i,
  /\bthanks?(?: you)? (?:so much |very much )?for calling\b/i,
  // Kiswahili
  /\bkwa ?heri\b/i,
  /\b(?:uwe|muwe|mkae|ukae) na (?:siku|jioni|usiku|wikendi|wiki|safari) (?:njema|nzuri|mwema|salama)\b/i,
  /\b(?:siku|jioni|wikendi) njema\b/i,
  /\busiku mwema\b/i,
  /\b(?:tutaonana|tutaongea|tutawasiliana)\b/i,
  /\bkaribu tena\b/i,
  /\basante (?:sana )?kwa kupiga(?: simu)?\b/i,
  // Sheng
  /\b(?:poa|sawa),? (?:basi )?(?:bye|kwaheri|tutaongea|baadaye)\b/i,
  /\b(?:tutapatana|tuko pamoja,? bye)\b/i,
];

// The agent is still offering help or asking for something.
const NOT_CLOSING = [
  /\?/,
  /\b(?:anything else|something else|can i help|how can i|would you like|do you want|let me know)\b/i,
  /\b(?:kitu kingine|naweza kukusaidia|ungependa|unataka)\b/i,
  /\b(?:but|however|before you go|ila|lakini|kabla)\b/i,
];

function lastSentence(text) {
  const parts = String(text || '')
    .trim()
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Is this committed agent line a goodbye?
 * @param {string} text
 * @returns {{ farewell: boolean, reason: string, sentence?: string }}
 */
function detectFarewell(text) {
  const raw = String(text || '').trim();
  if (!raw) return { farewell: false, reason: 'empty' };
  const sentence = lastSentence(raw);
  if (!sentence) return { farewell: false, reason: 'empty' };
  if (NOT_CLOSING.some((re) => re.test(sentence))) {
    return { farewell: false, reason: 'not_closing', sentence };
  }
  if (CLOSING.some((re) => re.test(sentence))) {
    return { farewell: true, reason: 'closing_phrase', sentence };
  }
  return { farewell: false, reason: 'no_closing_phrase', sentence };
}

// After a goodbye the caller often answers "Okay." / "Haya." / "Asante, bye".
// Those do not reopen the call. Anything else does.
const ACK_TOKENS = new Set([
  'ok', 'okay', 'okey', 'alright', 'all', 'right', 'sure', 'fine', 'cool', 'great',
  'thanks', 'thank', 'you', 'so', 'much', 'very', 'bye', 'goodbye', 'good', 'byebye',
  'haya', 'sawa', 'asante', 'sana', 'kwaheri', 'kwa', 'heri', 'poa', 'basi', 'ndio',
  'ndiyo', 'yes', 'yeah', 'yep', 'mm', 'mmm', 'mhm', 'hmm', 'eh', 'ehe', 'aha', 'na',
  'wewe', 'pia', 'too', 'same', 'to', 'nawe', 'shukran', 'shukrani', 'freshi', 'fiti',
  'safi', 'twende', 'tutaonana', 'baadaye', 'cheers',
]);

function isClosingAck(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  if (words.length > 6) return false;
  return words.every((w) => ACK_TOKENS.has(w) || /^m+h?m*$/.test(w));
}

function boundedMs(raw, { def, min, max }) {
  const n = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** VOICE_FAREWELL_HANGUP=off turns goodbye detection off (old behaviour). */
function farewellHangupEnabled(env = process.env) {
  const raw = String(env.VOICE_FAREWELL_HANGUP ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

/** Grace after the goodbye finishes playing, so the caller hears all of it. */
function farewellGraceMs(env = process.env) {
  return boundedMs(env.VOICE_FAREWELL_GRACE_MS, { def: 1500, min: 300, max: 5000 });
}

/**
 * The owner turned "Hang up after goodbye" off: stay on the line, but quietly.
 * No nudge, and close once the caller has been silent this long.
 */
function farewellSilentHangupMs(env = process.env) {
  return boundedMs(env.VOICE_FAREWELL_SILENT_HANGUP_MS, { def: 15000, min: 5000, max: 60000 });
}

/**
 * Chief (2026-10-09): a spoken goodbye ends the call, whatever the owner's
 * "Hang up after goodbye" toggle says; the toggle still decides whether the
 * model may end a call on its own (###ENDCALL###). Set
 * VOICE_FAREWELL_RESPECT_END_CALL=on to make the toggle keep the line open
 * (quietly, closing after VOICE_FAREWELL_SILENT_HANGUP_MS) instead.
 */
function farewellRespectsEndCallToggle(env = process.env) {
  const raw = String(env.VOICE_FAREWELL_RESPECT_END_CALL ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

/**
 * When to hang up after a goodbye.
 * @param {{ endCallAllowed?: boolean, playbackRemainingMs?: number, source?: string, env?: object }} opts
 * source: 'brain_end' and 'model_end' always hang up on the grace; a
 * detected 'phrase' does too unless VOICE_FAREWELL_RESPECT_END_CALL=on and
 * the owner turned end_call off.
 */
function planFarewellClose({ endCallAllowed = true, playbackRemainingMs = 0, source = 'phrase', env = process.env } = {}) {
  const remaining = Math.max(0, Number(playbackRemainingMs) || 0);
  if (source === 'phrase' && endCallAllowed === false && farewellRespectsEndCallToggle(env)) {
    return { mode: 'silent', delayMs: remaining + farewellSilentHangupMs(env) };
  }
  return { mode: 'hangup', delayMs: remaining + farewellGraceMs(env) };
}

module.exports = {
  detectFarewell,
  farewellGraceMs,
  farewellHangupEnabled,
  farewellRespectsEndCallToggle,
  farewellSilentHangupMs,
  isClosingAck,
  lastSentence,
  planFarewellClose,
};
