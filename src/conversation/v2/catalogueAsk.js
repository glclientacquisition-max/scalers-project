'use strict';
// ENGINE 1 helper (BRAIN_ENGINES, KB v2 businesses only): the typed catalogue ask in a caller turn.
//   { kind: 'overview' }            "what do you offer?", "mnauza nini?"
//   { kind: 'item', item: 'pianos' } "do you sell pianos?", "mna piano?" (the caller's own words, whether or not we sell it)
// The understanding model returns the same field (asked_item); this is the rules fallback used when the model is
// off, slow (understanding cap) or returns nothing. It only TYPES the ask: the catalogue tool decides offered / off /
// not in the catalogue, and the response engine writes the reply from that receipt.

const OVERVIEW = [
  /\bwhat (?:else |all )?(?:do|can|did) (?:you|u|y'?all)(?: guys)? (?:offer|sell|have|do|stock|carry|provide)\b(?!\s+(?:on|at|in|for|about|with|tomorrow|today)\b)\s*(?:\?|$|here|there|please|exactly)/i,
  /\bwhat (?:services|products|items|things|goods|stuff) (?:do|can) (?:you|u)\b/i,
  /\bwhat (?:is|are) (?:on offer|your (?:services|products|prices list|list))\b/i,
  /\bwhat can i (?:get|buy|order) (?:from you|here)\b/i,
  /\btell me (?:about )?(?:your (?:services|products)|what you (?:offer|sell|do|have))\b/i,
  /\b(?:mnauza|unauza|mnatoa|unatoa|mnafanya|unafanya|mnaoffer|mnaofa|mna|una)\s+(?:nini|vitu gani|bidhaa gani|huduma gani)\b/i,
  /\b(?:huduma|bidhaa) (?:zenu|zako) ni (?:gani|zipi)\b/i,
];
// "do you sell X" / "mnauza X": X is the caller's own words, cut at a time / place / filler tail
const ITEM = [
  /\b(?:do|can|could|would|will) (?:you|u|y'?all)(?: guys)? (?:sell|have|offer|stock|carry|supply|do|provide)\s+(.+)$/i,
  /\b(?:have you got|is there|are there|got any|i(?:'m| am) looking for|i want to buy|i(?:'d| would) like to buy|where can i (?:get|buy))\s+(.+)$/i,
  /\b(?:mnauza|unauza|mnayo|unayo|mnatoa|unatoa|mnafanya|unafanya|natafuta|nataka kununua|mnaleta|mna|una|kuna)\s+(.+)$/i,
];
const TAIL = /\s+(?:on|at|in|for|from|by|to|this|next|tomorrow|today|tonight|please|here|there|too|as well|also|at all|kesho|leo|hapa|huko|pia|kweli|tafadhali|sasa|saa|siku)\b.*$|[?.!,;:].*$/i;
const LEAD = /^(?:any|some|a|an|the|your|those|these|that|this|ma)\s+/i;
// words that are never a catalogue item (time, booking, place, payment, contact asks): not a catalogue ask at all
const NOT_ITEM = /^(?:nini|gani|what|which|time|times|slot|slots|space|availability|available|opening|openings|appointment|appointments|booking|bookings|delivery|transport|discount|discounts|offers?|deals?|branch|branches|office|location|shop|store|website|email|whatsapp|number|phone|mpesa|m-pesa|paybill|till|card|payment|payments|account|parking|someone|anyone|somebody|a minute|a moment|muda|nafasi|wakati|tawi|duka|ofisi|namba|simu|malipo|shida|swali|tatizo|problem|question|questions|idea|ideas|it|that|this|them|one|ones|any|some|more|else|anything|everything|something|kitu|chochote|vingine|zingine|nyingine)\b/i;

function cleanItem(raw) {
  let s = ` ${String(raw || '').trim()}`.replace(TAIL, '').trim().replace(LEAD, '').replace(LEAD, '').trim();
  s = s.replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!s || s.length < 2 || s.split(' ').length > 5) return null;
  if (NOT_ITEM.test(s)) return null;
  return s.toLowerCase();
}

/** -> { kind: 'overview' } | { kind: 'item', item } | null. Pure. */
function catalogueAsk(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  for (const re of OVERVIEW) if (re.test(t)) return { kind: 'overview', item: null };
  for (const re of ITEM) {
    const m = t.match(re);
    if (!m) continue;
    const item = cleanItem(m[1]);
    if (item) return { kind: 'item', item };
  }
  return null;
}

/** The typed field from the understanding model (asked_item), cleaned the same way. */
function fromModel(askedItem, answers = []) {
  const item = askedItem ? cleanItem(askedItem) : null;
  if (item) return { kind: 'item', item };
  return (answers || []).includes('services') ? { kind: 'overview', item: null } : null;
}

module.exports = { catalogueAsk, fromModel, cleanItem };
