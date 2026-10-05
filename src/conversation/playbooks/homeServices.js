// Home-services vertical playbooks — visit booking and job requests.

/** @typedef {'hours_open'|'directions'|'service_inquiry'|'price_band'|'service_area'|'book_visit'|'reschedule'|'cancel'|'emergency'|'human'|'other'} HomeIntent */

/** @type {Array<{
 *   id: HomeIntent,
 *   label: string,
 *   requiredSlots: string[],
 *   optionalSlots: string[],
 *   completion: string,
 *   tool: string|null,
 *   patterns: RegExp[],
 * }>} */
const HOME_INTENTS = [
  {
    id: 'hours_open',
    label: 'Hours / open now',
    requiredSlots: [],
    optionalSlots: [],
    completion: 'Answer from CONTEXT HEADER hours/bulletin. Do not invent hours.',
    tool: null,
    patterns: [
      /\b(open|closed|hours|working\s*hours|are you (open|closed)|mpaka saa|mnafungua|mnafunga)\b/i,
    ],
  },
  {
    id: 'directions',
    label: 'Depot / we come to you',
    requiredSlots: [],
    optionalSlots: ['branch'],
    completion:
      'Answer from LOCATIONS. Clarify whether caller visits you or you go to them. Never invent an address.',
    tool: null,
    patterns: [
      /\b(where|location|directions?|landmark|depot|office|uko wapi|mko wapi|address|come to (me|us|my)|mnakuja)\b/i,
    ],
  },
  {
    id: 'price_band',
    label: 'Price / quote band',
    requiredSlots: ['service'],
    optionalSlots: [],
    completion:
      'Answer price_range from SERVICES for that job. If quote-on-site only, say so honestly — never invent a fixed price.',
    tool: null,
    patterns: [
      /\b(how much|price|bei|gharama|quote|quotation|cost|pesa gani|rates?)\b/i,
    ],
  },
  {
    id: 'service_area',
    label: 'Service area / coverage',
    requiredSlots: [],
    optionalSlots: ['area'],
    completion:
      'If POLICIES has a Coverage line, that list is the service area. Delivery text is timing and other instructions. If there is no Coverage line, use Delivery and LOCATIONS coverage notes. If outside the area, say that area is outside our coverage. Do not offer a callback note until a callback row is saved. Do not promise a visit.',
    tool: null,
    patterns: [
      /\b(service area|coverage|do you (cover|serve|come to)|mnaenda|mnafanya (kwa| Nairobi|kiambu|mombasa)|areas?)\b/i,
    ],
  },
  {
    id: 'book_visit',
    label: 'Book a visit',
    requiredSlots: ['service', 'name', 'when', 'location'],
    optionalSlots: ['notes'],
    completion:
      'Ask where we should come ("Where should we come?" / "Tuje wapi?"). Never say landmark. Area plus gate, building, or junction is enough. If they give only an area, ask once for a building, gate, or junction, then stop. After that follow-up, if the area is inside POLICIES/LOCATIONS, append create_appointment and note confirm access. If it is outside, do not create_appointment. If coverage is not on file, do not invent it and do not save an area-only visit. If they refuse a place twice, escalate or log an enquiry. Do not say the time is booked. Speak nothing on the tool turn. House, carpet, couch, mattress, and Airbnb cleans are book_visit.',
    tool: 'create_appointment',
    patterns: [
      /\b(book|booking|appointment|schedule|visit|come (over|by|tomorrow|today)|nitakuja|njoo|tandika|install|repair|fix)\b/i,
      /\b(clean (my|the|our)|need (a |my )?(clean|carpet|couch|sofa|mattress|upholstery)|carpet clean|mattress clean|house clean|airbnb clean|sofa clean|couch clean)\b/i,
      /\b(?:carpet|couch|sofa|mattress|house|upholstery|air\s*bnb|airbnb)\s+clean(?:ing|up)?\b/i,
      /\b(?:urgent|asap|emergency|literally now|right now)\b.{0,48}\b(?:clean|carpet|couch|sofa|mattress|air\s*bnb|airbnb|house)\b/i,
      /\b(?:clean|carpet|couch|sofa|mattress|air\s*bnb|airbnb|house)\b.{0,48}\b(?:urgent|asap|emergency|literally now|right now|needed now)\b/i,
      /\b(?:carpet|couch|sofa|mattress|house|upholstery|airbnb)\s+clean(?:ing)?\b.*\b(?:tomorrow|today|tonight|kesho|leo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    ],
  },
  {
    id: 'reschedule',
    label: 'Reschedule visit',
    requiredSlots: ['when'],
    optionalSlots: ['service'],
    completion:
      'Collect only the new when. Do not say the visit is moved yet. Append update_appointment with when_text. Match the caller’s latest open visit if id unknown. Same hours check as a new booking. Same-hour as another visit is allowed.',
    tool: 'update_appointment',
    patterns: [
      /\b(reschedule|move|change (the )?(time|date|appointment|visit)|badilisha|ahirisha)\b/i,
    ],
  },
  {
    id: 'cancel',
    label: 'Cancel visit',
    requiredSlots: [],
    optionalSlots: ['service', 'reason'],
    completion:
      'If they clearly want to cancel, append update_appointment status=cancelled for their latest open visit. Do not say it is cancelled until the backend speaks.',
    tool: 'update_appointment',
    patterns: [
      /\b(cancel|cancelled|cancellation|sitaki|toroka|futa appointment|futa booking)\b/i,
    ],
  },
  {
    id: 'service_inquiry',
    label: 'Do you offer / service ask',
    requiredSlots: ['service'],
    optionalSlots: [],
    completion:
      'Answer from SERVICES only. If not listed or out_of_scope, use UNKNOWN REQUEST LINE and offer to log an enquiry — never invent services.',
    tool: null,
    patterns: [
      /\b(do you (do|offer|provide|handle)|mnatoa|mnafanya|services?|plumbing|cleaning|electrical|repair)\b/i,
    ],
  },
  {
    id: 'emergency',
    label: 'True emergency',
    requiredSlots: ['name', 'reason'],
    optionalSlots: [],
    completion:
      'True emergency only: burst pipe, flooding, fire, gas leak, or electric shock. Capture name + reason (save_caller_info). Follow POLICIES / HANDOFF MODE. Escalate when justified. Do not invent an ETA. Never substitute plumber or repair advice for escalate. Optional honesty (we are not plumbers) only after escalate is queued. Same-day, urgent, or ASAP cleaning is book_visit, not emergency.',
    tool: 'escalate',
    patterns: [
      /\b(burst(\s+pipe)?|bust\s+pipe|papers?\s+bust|pipe\s*has|pipehas|flood(ing)?|gas leak|electric shock|live wire|on fire|water everywhere|hatari)\b/i,
      /\bemergency\b.{0,40}\b(pipe|flood|leak|shock|wire|fire|gas|power|water)\b/i,
      /\b(pipe|flood|leak|shock|wire|fire|gas|water)\b.{0,40}\bemergency\b/i,
    ],
  },
  {
    id: 'human',
    label: 'Talk to a human',
    requiredSlots: ['name', 'reason'],
    optionalSlots: [],
    completion:
      'Follow HANDOFF MODE. On contact urgent, ask name then the need, one question each, then escalate. Do not recite the service list. Never say stay on the line. Never claim a live transfer.',
    tool: 'escalate',
    patterns: [
      /\b(human|person|someone|owner|manager|boss|agent|speak to|talk to|nipe|nataka kuongea na|contact urgent|urgent contact)\b/i,
    ],
  },
  {
    id: 'other',
    label: 'Other / unclear',
    requiredSlots: [],
    optionalSlots: ['name', 'reason'],
    completion:
      'Clarify once if needed. Answer from ground truth when possible. Otherwise capture name + reason and log enquiry/callback.',
    tool: null,
    patterns: [],
  },
];

const INTENT_BY_ID = Object.fromEntries(HOME_INTENTS.map((i) => [i.id, i]));

const CLEANING_JOB =
  /\b(carpet|couch|sofa|mattress|house|upholstery|air\s*bnb|airbnb|bnb)\b/i;
const CLEANING_VERB = /\b(clean(?:ing)?|cleanup|fanya(?:\s+usafi)?)\b/i;
const URGENCY_MARKERS =
  /\b(urgent(?:ly)?|asap|a\.?s\.?a\.?p\.?|emergency|literally\s+now|right\s+now|needed\s+now|now)\b/i;

/**
 * Urgent / ASAP / "emergency" on a cleaning or Airbnb job — visit class only.
 * @param {string} utterance
 */
function looksLikeVisitClassCleaningUrgency(utterance) {
  const text = String(utterance || '').trim().toLowerCase();
  if (!text) return false;
  if (looksLikeTrueHomeEmergency(text)) return false;
  if (!URGENCY_MARKERS.test(text)) return false;
  if (/\b(do you|mnatoa|mnafanya|offer|provide)\b/.test(text)) return false;
  return (
    (CLEANING_JOB.test(text) && CLEANING_VERB.test(text)) ||
    (CLEANING_JOB.test(text) && /\bairbnb\b/i.test(text)) ||
    (URGENCY_MARKERS.test(text) && CLEANING_VERB.test(text) && CLEANING_JOB.test(text))
  );
}

/**
 * Burst pipe, flood, fire, gas, shock — including mild STT garble on live calls.
 * @param {string} utterance
 */
function looksLikeTrueHomeEmergency(utterance) {
  const text = String(utterance || '').trim().toLowerCase();
  if (!text) return false;
  if (
    /\b(burst(\s+pipe)?|bust\s+pipe|papers?\s+bust|pipe\s*has|pipehas|flood(ing)?|gas\s+leak|electric\s+shock|live\s+wire|on\s+fire|water\s+everywhere|hatari)\b/.test(
      text
    )
  ) {
    return true;
  }
  return (
    /\bemergency\b/.test(text) &&
    /\b(pipe|flood|leak|shock|wire|fire|gas|power|water)\b/.test(text)
  );
}

/**
 * Escalate reason text that is really visit-class cleaning urgency (false emergency).
 * @param {string} reason
 */
function isVisitClassEscalateReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return false;
  if (looksLikeTrueHomeEmergency(text)) return false;
  return looksLikeVisitClassCleaningUrgency(text);
}

/**
 * @param {string} utterance
 * @returns {HomeIntent}
 */
function classifyHomeIntent(utterance) {
  const text = String(utterance || '').trim();
  if (!text) return 'other';
  if (looksLikeVisitClassCleaningUrgency(text)) return 'book_visit';
  if (looksLikeTrueHomeEmergency(text)) return 'emergency';
  if (/\b(do you|mnatoa|mnafanya|offer|provide)\b/i.test(text)) {
    if (INTENT_BY_ID.service_inquiry.patterns.some((re) => re.test(text))) {
      return 'service_inquiry';
    }
  }
  if (INTENT_BY_ID.price_band.patterns.some((re) => re.test(text))) {
    return 'price_band';
  }

  /** @type {HomeIntent[]} */
  const priority = [
    'emergency',
    'cancel',
    'reschedule',
    'book_visit',
    'human',
    'hours_open',
    'service_area',
    'directions',
    'price_band',
    'service_inquiry',
  ];

  for (const id of priority) {
    const intent = INTENT_BY_ID[id];
    if (intent.patterns.some((re) => re.test(text))) return id;
  }
  return 'other';
}

/**
 * @param {HomeIntent|string} intentId
 * @param {Record<string, string|undefined|null>} slots
 * @returns {string[]}
 */
function missingHomeSlots(intentId, slots = {}) {
  const intent = INTENT_BY_ID[intentId] || INTENT_BY_ID.other;
  const missing = [];
  for (const key of intent.requiredSlots) {
    const value =
      key === 'location'
        ? slots.location || slots.landmark || slots.address
        : slots[key];
    if (!String(value || '').trim()) missing.push(key);
  }
  return missing;
}

function canCompleteHomeIntent(intentId, slots = {}) {
  return missingHomeSlots(intentId, slots).length === 0;
}

/**
 * @param {{ handoffMode?: string }} [opts]
 */
function formatHomeServicesPlaybookForPrompt(opts = {}) {
  const handoff = String(opts.handoffMode || 'callback').trim() || 'callback';
  const lines = [
    'HOME SERVICES PLAYBOOK (follow for this business — finish the caller job):',
    'On each turn: identify the intent below, collect only missing required slots (ONE question max), then complete.',
    'Use SERVICES for job types and price bands. Use LOCATIONS + POLICIES for coverage and “we come to you”.',
    `Handoff mode for human/emergency asks: ${handoff}.`,
    '',
  ];

  for (const intent of HOME_INTENTS) {
    if (intent.id === 'other') continue;
    const req = intent.requiredSlots.length
      ? `Required: ${intent.requiredSlots.join(', ')}.`
      : 'Required: none.';
    const tool = intent.tool ? ` Tool: ${intent.tool}.` : '';
    lines.push(
      `- ${intent.id} (${intent.label}): ${req} ${intent.completion}${tool}`
    );
  }

  lines.push(
    `- other: clarify once if needed; otherwise answer from ground truth or log enquiry/callback.`,
    '',
    'Completion rules:',
    '- Prefer resolving from LIVE GROUND TRUTH over promising a callback.',
    '- CONTROL VOICE: name the job you have, then one question or silence for the tool. No holding lines.',
    '- VISIT SOP (think this; do not read it aloud): hear the ask; collect only missing slots in order (service, name, when, location); silently check hours (not a one-visit lock); same-hour visits are allowed; check POLICIES/LOCATIONS before create_appointment; fire the tool and speak nothing; never say booked, moved, or cancelled first. Never say landmark.',
    '- Once a name is in CALL STATE, never ask for the name again. Do not make "is that right?" a visit step. Move to when, then location (where we should come), then create_appointment.',
    '- Book: create_appointment after service + name + when + location. Where we come means an area plus a gate, building, or junction. One follow-up if only an area. In coverage after that follow-up: save the area and note confirm access. Outside coverage: no appointment. Refused twice: enquiry or human, no save.',
    '- Reschedule only when they ask to move a visit: update_appointment with the new when against the visit they name, or the only open one. Keep the saved location unless they change it. If they ask what they have, do not reschedule. The backend speaks the open rows.',
    '- Cancel: update_appointment status=cancelled. Attendance confirm is not a new booking. Cancel does not need a location.',
    '- Emergency and human escalate do not wait for a location.',
    '- Never invent prices, coverage, or ETAs. Use the coverage list on file. Do not invent areas.',
    '- Out of coverage: say that area is outside our coverage. Do not offer a callback note until a callback row is saved. Okay, Sawa, or leave it is not a booking. Do not say you will serve them tomorrow.',
    '- In coverage: confirm service, day, time, and place, then the tool, then speak only the facts the tool saved.',
    '- Then, Okay, and Sawa are not a yes and not a time.',
    '- Cleaning, repair, install, pest, and similar jobs share this spine. Use SERVICES names; do not invent a niche that is not listed.',
    '- Bare urgent / ASAP / same-day / caller says emergency on cleaning or Airbnb is book_visit. Never escalate for that.',
    '- Escalate only for burst, flood, fire, gas, or shock. Never invent plumber, stock, or trade repair advice.',
    '- Out of Train scope: use UNKNOWN REQUEST LINE and note/callback. Do not bluff expertise.',
    '- After a clear completion, confirm briefly and goodbye.'
  );

  return lines.join('\n');
}

module.exports = {
  HOME_INTENTS,
  classifyHomeIntent,
  looksLikeVisitClassCleaningUrgency,
  looksLikeTrueHomeEmergency,
  isVisitClassEscalateReason,
  missingHomeSlots,
  canCompleteHomeIntent,
  formatHomeServicesPlaybookForPrompt,
};
