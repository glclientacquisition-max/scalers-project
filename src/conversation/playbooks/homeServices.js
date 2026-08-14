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
      'Answer from POLICIES delivery/service-area notes and LOCATIONS coverage. If outside area, say so and offer to note a callback — do not promise a visit.',
    tool: null,
    patterns: [
      /\b(service area|coverage|do you (cover|serve|come to)|mnaenda|mnafanya (kwa| Nairobi|kiambu|mombasa)|areas?)\b/i,
    ],
  },
  {
    id: 'book_visit',
    label: 'Book a visit',
    requiredSlots: ['service', 'name', 'when', 'landmark'],
    optionalSlots: ['notes'],
    completion:
      'Once service + caller name + time window + landmark/address are known, append create_appointment. Never fire without all four. Speak only an attempt line; backend confirms.',
    tool: 'create_appointment',
    patterns: [
      /\b(book|booking|appointment|schedule|visit|come (over|by|tomorrow|today)|nitakuja|njoo|tandika|install|repair|fix)\b/i,
    ],
  },
  {
    id: 'reschedule',
    label: 'Reschedule visit',
    requiredSlots: ['when'],
    optionalSlots: ['service'],
    completion:
      'Collect the new when. Append update_appointment with when_text (and status requested if needed). Match the caller’s latest open visit if id unknown.',
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
      'Confirm they want to cancel, then append update_appointment status=cancelled for their latest open visit.',
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
    label: 'Emergency / urgent',
    requiredSlots: ['name', 'reason'],
    optionalSlots: [],
    completion:
      'Acknowledge urgency. Capture name + reason (save_caller_info). Follow POLICIES / HANDOFF MODE — escalate when justified. Do not invent emergency ETA.',
    tool: 'escalate',
    patterns: [
      /\b(emergency|urgent|asap|burst|flood|leak(ing)?|no power|hatari|haraka sana|sasa hivi)\b/i,
    ],
  },
  {
    id: 'human',
    label: 'Talk to a human',
    requiredSlots: ['name', 'reason'],
    optionalSlots: [],
    completion:
      'Follow HANDOFF MODE. Capture name + reason. If escalate enabled, escalate. Never claim a live transfer unless it actually happens.',
    tool: 'escalate',
    patterns: [
      /\b(human|person|someone|owner|manager|boss|agent|speak to|talk to|nipe|nataka kuongea na)\b/i,
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

/**
 * @param {string} utterance
 * @returns {HomeIntent}
 */
function classifyHomeIntent(utterance) {
  const text = String(utterance || '').trim();
  if (!text) return 'other';

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
    if (!String(slots[key] || '').trim()) missing.push(key);
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
    '- For book_visit: only fire create_appointment after service + name + when + landmark are known.',
    '- For reschedule/cancel: use update_appointment; never invent that a visit was moved or cancelled.',
    '- Never invent prices, coverage, ETAs, or claim booked until backend confirmation.',
    '- After a clear completion, confirm briefly and goodbye.'
  );

  return lines.join('\n');
}

module.exports = {
  HOME_INTENTS,
  classifyHomeIntent,
  missingHomeSlots,
  canCompleteHomeIntent,
  formatHomeServicesPlaybookForPrompt,
};
