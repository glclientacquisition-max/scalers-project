// Joint Voice+Brain ack rule (briefs/v2-ack-overuse.md), behind VOICE_ACK_RULE (default off).
// One ack owner per turn: Voice plays at most one word ack (<=3 words) and only
// on a tool turn; the Brain line is then sent acked:true. No ack on the first
// turn, never two ack-led turns in a row, at most one per 3 turns. Fillers on
// other turns are a non-word "Mm." so the caller never hears ack+ack.

const ACK_LEAD_WIDE =
  /^\s*(?:sawa(?:\s+sawa|\s+kabisa)?|ni\s+sawa|okay|ok|alright|haya|asante|sure|poa)\s*[.,!]\s*(?=\S)/i;
const ACK_WORD =
  /^\s*(?:sawa(?:\s+sawa|\s+kabisa)?|ni\s+sawa|okay|ok|alright|haya|asante|sure|poa|great|got it)\b/i;
const CALLER_ACK = /^\s*(?:sawa(?:\s+sawa)?|ni\s+sawa|okay|ok|alright|haya|poa|sure|fine)[.!,\s]*$/i;
const CLOSING = /\b(kwaheri|goodbye|good bye|bye|karibu tena|thanks for calling|asante kwa kupiga)\b/i;
const NON_WORD = { sw: 'Mm.', sheng: 'Mm.', en: 'Mm-hmm.' };
const TOOL_ACK = { sw: 'Sawa.', sheng: 'Poa.', en: 'Got it.' };
const SPACING = 3;

function ackRuleEnabled(env = process.env) {
  const v = String(env.VOICE_ACK_RULE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

function isAckLed(text) {
  const t = String(text || '');
  return ACK_WORD.test(t) && !/^\s*mm/i.test(t);
}
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
    allowed() {
      if (ackThisTurn) return false; // already one this turn
      if (turn <= 1) return false; // first turn
      if (lastTurnAckLed) return false; // never two in a row
      if (callerAck) return false; // caller's own sawa: answer with content
      return turn - lastAckTurn >= SPACING; // max one per 3 turns
    },
    /** Record a line the caller heard first on this turn. */
    noteHeard(text) {
      if (ackThisTurn) return;
      if (isAckLed(text) && !isClosing(text)) { ackThisTurn = true; lastAckTurn = turn; }
    },
    get ackThisTurn() { return ackThisTurn; },
    get turn() { return turn; },
  };
}

/**
 * Filler under the rule. Word ack only at tool start when allowed; else non-word.
 * @returns {{ text: string, word: boolean }}
 */
function pickRuleFiller({ lang, toolTurn = false, tracker } = {}) {
  const k = langKey(lang);
  if (toolTurn && tracker && tracker.allowed()) return { text: TOOL_ACK[k], word: true };
  return { text: NON_WORD[k], word: false };
}

/** Backstop on a spoken line: strip the lead if an ack already played or the rule forbids one. */
function applyAckBackstop(line, { tracker, acked = false } = {}) {
  const text = String(line || '');
  if (!isAckLed(text) || isClosing(text)) return text;
  if (acked || (tracker && !tracker.allowed())) return stripAckLead(text);
  return text;
}

/**
 * Score heard turns: [{ text, filler? }] per bot turn (filler first if any).
 * ack-led % excludes closings; stack = word filler + ack-led line in one turn.
 */
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
    const led = isAckLed(heard);
    if (filler && isAckLed(filler) && isAckLed(line)) stacks += 1;
    if (led) { ackLed += 1; run += 1; longestRun = Math.max(longestRun, run); } else run = 0;
  }
  const ackLedPct = counted ? Math.round((ackLed / counted) * 1000) / 10 : 0;
  return { counted, ackLed, ackLedPct, stacks, longestRun, fillerOver3, pass: ackLedPct <= 10 && stacks === 0 };
}

module.exports = {
  ACK_LEAD_WIDE, ackRuleEnabled, isAckLed, isClosing, isCallerAck, stripAckLead,
  createAckTracker, pickRuleFiller, applyAckBackstop, scoreAckRule,
};
