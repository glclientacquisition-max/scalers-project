// Retail vertical playbooks — intent map, slots, and prompt guidance.
// The voice LLM still speaks; this module defines how each job gets finished.

/** @typedef {'hours_open'|'directions'|'product_inquiry'|'price'|'availability'|'hold_or_pickup'|'order_enquiry'|'policy'|'human'|'other'} RetailIntent */

/** @type {Array<{
 *   id: RetailIntent,
 *   label: string,
 *   requiredSlots: string[],
 *   optionalSlots: string[],
 *   completion: string,
 *   tool: string|null,
 *   patterns: RegExp[],
 * }>} */
const RETAIL_INTENTS = [
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
    label: 'Directions / location',
    requiredSlots: [],
    optionalSlots: ['branch'],
    completion:
      'Answer from LOCATIONS landmark/directions. If multiple locations and branch unclear, ask which branch once.',
    tool: null,
    patterns: [
      /\b(where|location|directions?|landmark|how (do|can) i (find|get)|uko wapi|mko wapi|address)\b/i,
    ],
  },
  {
    id: 'price',
    label: 'Price',
    requiredSlots: ['product'],
    optionalSlots: [],
    completion:
      'Answer price_range/price from catalog for that product. If unknown, say so and offer to note an enquiry — never invent a price.',
    tool: null,
    patterns: [
      /\b(how much|price|bei|gharama|inaenda|cost|pesa gani)\b/i,
    ],
  },
  {
    id: 'availability',
    label: 'In stock / availability',
    requiredSlots: ['product'],
    optionalSlots: [],
    completion:
      'Answer from catalog in_stock (yes/no/unknown). If unknown or no, offer to log a hold/enquiry with create_service_request.',
    tool: null,
    patterns: [
      /\b(in stock|available|do you have|mna(na)?|iko|stock|bado iko)\b/i,
    ],
  },
  {
    id: 'hold_or_pickup',
    label: 'Hold / pickup',
    requiredSlots: ['product', 'name', 'when'],
    optionalSlots: ['quantity'],
    completion:
      'Once product + caller name + pickup/when are known, confirm and append create_service_request type=hold. Then goodbye.',
    tool: 'create_service_request:hold',
    patterns: [
      /\b(hold|weka|reserve|pickup|pick\s*up|nitapita|nitakuja|keep (it|one|two|them) for)\b/i,
    ],
  },
  {
    id: 'order_enquiry',
    label: 'Order / buy intent',
    requiredSlots: ['product', 'name'],
    optionalSlots: ['quantity', 'when'],
    completion:
      'Confirm product (+ qty if given) and name, append create_service_request type=order, set expectations for owner follow-up.',
    tool: 'create_service_request:order',
    patterns: [
      /\b(order|buy|purchase|nataka kununua|ninaorder|deliver(y)?)\b/i,
    ],
  },
  {
    id: 'product_inquiry',
    label: 'Product / do you sell',
    requiredSlots: ['product'],
    optionalSlots: [],
    completion:
      'Answer from catalog only. If not listed, use UNKNOWN REQUEST LINE and offer to log an enquiry — never invent products.',
    tool: null,
    patterns: [
      /\b(do you sell|do you offer|mnauza|mna(uza|fanya)|what do you (sell|have)|products?|catalog)\b/i,
    ],
  },
  {
    id: 'policy',
    label: 'Policy',
    requiredSlots: [],
    optionalSlots: ['policy_key'],
    completion:
      'Answer from POLICIES (payment, returns, delivery, deposit, etc.). If missing, say you will note it — never invent policy.',
    tool: null,
    patterns: [
      /\b(return|refund|exchange|policy|delivery|deposit|warranty|mpesa|m-?pesa|payment|lipa)\b/i,
    ],
  },
  {
    id: 'human',
    label: 'Talk to a human',
    requiredSlots: ['name', 'reason'],
    optionalSlots: [],
    completion:
      'Follow HANDOFF MODE. Capture name + reason (save_caller_info). If escalate enabled, escalate. Do not claim a live transfer unless handoff mode is live_transfer and transfer actually happens.',
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

const INTENT_BY_ID = Object.fromEntries(RETAIL_INTENTS.map((i) => [i.id, i]));

/**
 * Heuristic intent classification for smoke tests / future pre-routing.
 * Prefer more specific intents when multiple patterns match.
 * @param {string} utterance
 * @returns {RetailIntent}
 */
function classifyRetailIntent(utterance) {
  const text = String(utterance || '').trim();
  if (!text) return 'other';

  /** @type {RetailIntent[]} */
  const priority = [
    'hold_or_pickup',
    'order_enquiry',
    'human',
    'hours_open',
    'directions',
    'price',
    'availability',
    'policy',
    'product_inquiry',
  ];

  for (const id of priority) {
    const intent = INTENT_BY_ID[id];
    if (intent.patterns.some((re) => re.test(text))) return id;
  }
  return 'other';
}

/**
 * @param {RetailIntent|string} intentId
 * @param {Record<string, string|undefined|null>} slots
 * @returns {string[]} missing required slot names
 */
function missingRetailSlots(intentId, slots = {}) {
  const intent = INTENT_BY_ID[intentId] || INTENT_BY_ID.other;
  const missing = [];
  for (const key of intent.requiredSlots) {
    if (!String(slots[key] || '').trim()) missing.push(key);
  }
  return missing;
}

/**
 * @param {RetailIntent|string} intentId
 * @param {Record<string, string|undefined|null>} slots
 */
function canCompleteRetailIntent(intentId, slots = {}) {
  return missingRetailSlots(intentId, slots).length === 0;
}

/**
 * Prompt block injected for retail tenants (live, highest-priority job map).
 * @param {{ handoffMode?: string }} [opts]
 */
function formatRetailPlaybookForPrompt(opts = {}) {
  const handoff = String(opts.handoffMode || 'callback').trim() || 'callback';
  const lines = [
    'RETAIL PLAYBOOK (follow for this business — finish the caller job):',
    'On each turn: identify the intent below, collect only missing required slots (ONE question max), then complete.',
    'Use SERVICES for offerings (delivery, sourcing). Use PRODUCT CATALOGUE for individual items, prices, and stock. Share SOCIAL & WEB handles when asked.',
    `Handoff mode for human asks: ${handoff}.`,
    '',
  ];

  for (const intent of RETAIL_INTENTS) {
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
    '- For hold_or_pickup / order_enquiry: only fire create_service_request after required slots are known.',
    '- Never invent products, prices, stock, or policies.',
    '- After a clear completion (answered or request logged), confirm briefly and goodbye.'
  );

  return lines.join('\n');
}

module.exports = {
  RETAIL_INTENTS,
  classifyRetailIntent,
  missingRetailSlots,
  canCompleteRetailIntent,
  formatRetailPlaybookForPrompt,
};
