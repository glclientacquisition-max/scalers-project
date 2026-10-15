// Joint Voice+Brain ack rule (briefs/v2-ack-overuse.md), behind VOICE_ACK_RULE (default off).
// One ack owner per turn: Voice plays at most one word ack (<=3 words) and only
// on a tool turn; the Brain line is then sent acked:true. No ack on the first
// turn, never two ack-led turns in a row, at most one per 3 turns. Fillers on
// other turns are a non-word "Mm." so the caller never hears ack+ack.

const ACK_LEAD_WIDE =
  /^\s*(?:sawa(?:\s+sawa|\s+kabisa)?|ni\s+sawa|okay|ok|alright|haya|asante(?:\s+sana)?|sure|poa)\s*[.,!]\s*(?=\S)/i;
// A whole line that is only an ack ("Sawa kabisa." / "Asante sana!").
const BARE_ACK = /^\s*(?:sawa(?:\s+sawa|\s+kabisa)?|ni\s+sawa|okay|ok|alright|haya|asante(?:\s+sana)?|sure|poa|great)\s*[.,!]*\s*$/i;
const ACK_NAME_LEAD = /^\s*(?:[Ss]awa|[Oo]kay|[Oo]k|[Aa]lright|[Hh]aya|[Pp]oa|[Nn]diyo)\s+([A-Z][a-z]+[,!]\s*)(?=\S)/;
const MM = /^\s*mm(?:-?hmm)?\b/i;
const QUESTION = /\?\s*$|\b(nani|gani|ngapi|wapi|lini|vipi|je|how|what|when|where|which|who|why|can you|unaweza|mnaweza|itaweza)\b/i;
const ACK_WORD =
  /^\s*(?:sawa(?:\s+sawa|\s+kabisa)?|ni\s+sawa|okay|ok|alright|haya|asante|sure|poa|great|got it)\b/i;
const CALLER_ACK = /^\s*(?:sawa(?:\s+sawa)?|ni\s+sawa|okay|ok|alright|haya|poa|sure|fine)[.!,\s]*$/i;
const CLOSING = /\b(kwaheri|goodbye|good bye|bye|karibu tena|thanks for calling|asante kwa kupiga)\b/i;
const NON_WORD = { sw: 'Mm.', sheng: 'Mm.', en: 'Mm-hmm.' };
// Tool turns: a status line, not an ack word (brief §6.3: a hold line is not an ack).
const TOOL_ACK = { sw: 'Naangalia.', sheng: 'Naangalia.', en: 'Let me check.' };
const SPACING = 3;
const MM_SPACING = 6;
const MM_MIN_WORDS = 8;
function wordCount(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }

function ackRuleEnabled(env = process.env) {
  const v = String(env.VOICE_ACK_RULE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

function isAckLed(text) {
  const t = String(text || '');
  return ACK_WORD.test(t) && !/^\s*mm/i.test(t);
}
/** What the caller heard as an ack: ack words AND a bare "Mm." (rule counts both). */
function isHeardAck(text) { return isAckLed(text) || MM.test(String(text || '')); }
function isBareAck(text) { return BARE_ACK.test(String(text || '')); }
function shortTurn(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length <= 3; }
function isClosing(text) { return CLOSING.test(String(text || '')); }
function isCallerAck(text) { return CALLER_ACK.test(String(text || '')); }
function langKey(lang) { const l = String(lang || '').toLowerCase(); return l === 'sw' || l === 'sheng' ? l : 'en'; }

/** Strip one leading ack word (wide list). Content unchanged. */
function stripAckLead(line) {
  const text = String(line || '');
  if (!ACK_LEAD_WIDE.test(text)) return text;
  const rest = text.replace(ACK_LEAD_WIDE, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Per-call tracker of what the caller heard. Turns are 1-based bot turns. */
function createAckTracker() {
  let turn = 0;
  let lastAckTurn = -Infinity;
  let lastTurnAckLed = false;
  let ackThisTurn = false;
  let callerAck = false;
  return {
    beginTurn({ callerText = '' } = {}) {
      if (turn > 0) lastTurnAckLed = ackThisTurn;
      turn += 1;
      ackThisTurn = false;
      callerAck = isCallerAck(callerText);
    },
    /** May an ack be heard on this turn at all? */
    allowed({ spacing = SPACING } = {}) {
      if (ackThisTurn) return false; // already one this turn
      if (turn <= 1) return false; // first turn
      if (lastTurnAckLed) return false; // never two in a row
      if (callerAck) return false; // caller's own sawa: answer with content
      return turn - lastAckTurn >= spacing; // max one per 3 turns (Mm: per MM_SPACING)
    },
    /** Record a line the caller heard first on this turn. */
    noteHeard(text) {
      if (ackThisTurn) return;
      if (isHeardAck(text) && !isClosing(text)) { ackThisTurn = true; lastAckTurn = turn; }
    },
    get ackThisTurn() { return ackThisTurn; },
    get turn() { return turn; },
  };
}

/**
 * Filler under the rule. Word ack only at tool start when allowed; else non-word.
 * @returns {{ text: string, word: boolean }}
 */
function pickRuleFiller({ lang, toolTurn = false, tracker, callerText = '' } = {}) {
  const k = langKey(lang);
  // Mm counts as an ack: same spacing (no first turn, never twice in a row, 1 per 3).
  if (toolTurn) return { text: TOOL_ACK[k], word: true, status: true };
  if (!tracker || !tracker.allowed()) return null;
  // No filler before a question answer or on a short turn ("Yeah.", "Si unaona?").
  if (shortTurn(callerText) || QUESTION.test(String(callerText || ''))) return null;
  // Mm only masks a long think: long caller turn, and rarer than word acks.
  if (wordCount(callerText) < MM_MIN_WORDS || !tracker.allowed({ spacing: MM_SPACING })) return null;
  return { text: NON_WORD[k], word: false };
}

/** Backstop on a spoken line: strip the lead if an ack already played or the rule forbids one. */
function applyAckBackstop(line, { tracker, acked = false, dropBare = false } = {}) {
  const text = String(line || '');
  if (!isAckLed(text)) return text;
  // A line that IS the goodbye ("Asante kwa kupiga simu") keeps its words.
  if (/^\s*(?:asante kwa|thanks for calling|thank you for calling|kwaheri|goodbye)/i.test(text)) return text;
  // After any filler, a reply sentence that is only an ack would stack ("Mm. Sawa kabisa.").
  if (dropBare && acked && isBareAck(text)) return '';
  // Voice owns the one ack per turn (filler/tool-start ack), so a reply never needs
  // its own lead: strip it on every turn; only a bare-ack reply with no filler stays.
  if (acked || tracker) {
    const out = stripAckLead(text);
    if (out !== text) return out;
    // "Sawa Chris, ..." -> "Chris, ..." (the name stays, the ack goes).
    const m = text.match(ACK_NAME_LEAD);
    return m ? text.slice(m[0].length - m[1].length) : text;
  }
  return text;
}

/**
 * Score heard turns: [{ text, filler? }] per bot turn (filler first if any).
 * ack-led % excludes closings; stack = word filler + ack-led line in one turn.
 */
/**
 * VOICE_NO_ANSWER_DELETE gap guard: with the ack rule on, a turn with no filler
 * and no audio by ~900 ms after end of turn gets a neutral "Mm." It is not an
 * ack-led reply; it counts toward stacks only when an ack word follows it.
 */
const GAP_FILL = 'Mm.';
function gapGuardEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.VOICE_NO_ANSWER_DELETE || '').trim());
}
function gapGuardMs(env = process.env) {
  const n = Number(env.VOICE_GAP_GUARD_MS);
  return Number.isFinite(n) && n >= 400 && n <= 2000 ? n : 900;
}

function scoreAckRule(turns = []) {
  let counted = 0; let ackLed = 0; let stacks = 0; let run = 0; let longestRun = 0; let fillerOver3 = 0;
  for (const t of turns) {
    const filler = String(t?.filler || '').trim();
    const line = String(t?.text || '').trim();
    const heard = filler || line;
    if (!heard) continue;
    if (filler && filler.split(/\s+/).length > 3) fillerOver3 += 1;
    if (isClosing(line) && !filler) { run = 0; continue; }
    counted += 1;
    // Heard ack includes "Mm."; a stack is any filler followed by an ack-led line.
    // A gap-guard Mm is not an ack-led reply; it stacks only with a following ack word.
    const led = t?.gap ? isHeardAck(line) : isHeardAck(heard);
    if (filler && (t?.gap ? true : isHeardAck(filler)) && isAckLed(line)) stacks += 1;
    if (led) { ackLed += 1; run += 1; longestRun = Math.max(longestRun, run); } else run = 0;
  }
  const ackLedPct = counted ? Math.round((ackLed / counted) * 1000) / 10 : 0;
  return { counted, ackLed, ackLedPct, stacks, longestRun, fillerOver3, pass: ackLedPct <= 10 && stacks === 0 };
}

/**
 * Replay logged heard turns ({caller, filler, reply}) through the rule as live does:
 * tracker per call, filler from pickRuleFiller, reply backstop (bare ack dropped).
 */
function replayHeard(turns = [], { lang = 'sw', gapGuard = false, gapMs = 900 } = {}) {
  const tr = createAckTracker();
  return turns.map((t) => {
    tr.beginTurn({ callerText: t.caller || '' });
    const tool = /^(sawa, )?nime(hifadhi|hamisha|weka|futa|badilisha|ghairi)|nimemtumia|watakupigia|i've saved|they'll call/i.test(String(t.reply || ''));
    let filler = '';
    if (t.filler) {
      const p = pickRuleFiller({ lang, toolTurn: tool, tracker: tr, callerText: t.caller || '' });
      filler = p ? p.text : '';
      if (filler) tr.noteHeard(filler);
    }
    let gap = false;
    if (gapGuard && !filler && Number(t.firstPcmMs) > gapMs) { filler = GAP_FILL; gap = true; }
    const text = applyAckBackstop(String(t.reply || ''), { tracker: tr, acked: Boolean(filler), dropBare: true });
    tr.noteHeard(text);
    return gap ? { filler, text, gap } : { filler, text };
  });
}

module.exports = {
  replayHeard, GAP_FILL, gapGuardEnabled, gapGuardMs,
  ACK_LEAD_WIDE, ackRuleEnabled, isAckLed, isClosing, isCallerAck, stripAckLead,
  isHeardAck, isBareAck, shortTurn, createAckTracker, pickRuleFiller, applyAckBackstop, scoreAckRule,
};
