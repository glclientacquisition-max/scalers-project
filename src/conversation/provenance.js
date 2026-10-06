// Provenance adapter for compile and live ground truth.
//
// Platform does not yet store tenant_field_meta. This module reads whatever
// signal is already on the JSON value (source, status, confirmed_by,
// confirmed_at, or a nested envelope) and otherwise treats an exact vertical
// pack seed as source "seed". Unmarked text that is not a pack seed stays
// owner so existing owner-typed rows keep working until Platform backfills.
//
// Only owner, or an explicit confirm, is fact. seed and call_suggested cap at
// suggested and never compile or speak as GOLDEN. import and inferred are not
// fact until confirmed. Empty policy text is unknown. Never invent a default.

const SOURCES = new Set(['owner', 'seed', 'import', 'inferred', 'call_suggested']);

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact pack FAQ question + answer pairs (retail and home starters). */
const PACK_FAQ_PAIRS = [
  [
    'What are your opening hours?',
    'We are open Monday to Saturday. Confirm the exact times in Train if they differ.',
  ],
  [
    'Where are you located?',
    'Share your shop landmark and street in Train so callers get accurate directions.',
  ],
  [
    'Do you accept M-Pesa?',
    'Yes, we accept M-Pesa. You can pay on pickup or delivery as arranged.',
  ],
  [
    'Can you hold an item for me?',
    'Yes. Tell us the item, your name, and when you will pick up, and we will log a hold.',
  ],
  [
    'Do you deliver?',
    'Yes. Same-day in Nairobi for stocked items when available, and countrywide shipping.',
  ],
  [
    'Can you source a book that is not in stock?',
    'Yes. Request the title and we will source it, usually with a free quotation first.',
  ],
  [
    'What are your opening hours?',
    'We take calls during business hours. Confirm exact times in Train if they differ.',
  ],
  [
    'Do you come to my location?',
    'Yes. We visit clients in our service area. Share your landmark when booking.',
  ],
  [
    'Which areas do you cover?',
    'We cover our listed service areas. Outside coverage we may decline or note a callback honestly.',
  ],
  [
    'How much does a visit cost?',
    'Many jobs are quoted on site from the price band in Train. We never invent a fixed price.',
  ],
  [
    'Can I book a visit over the phone?',
    'Yes. Tell us the service, your name, preferred time window, and landmark.',
  ],
  [
    'Do you clean carpets, couches, or mattresses?',
    'If those jobs are listed in Train, we book them as visits. If not listed, we say so and can note an enquiry.',
  ],
  [
    'Can I get the same day?',
    'If we are open and the time is inside hours, we can take the visit. We do not invent a travel ETA.',
  ],
  [
    'What if it is an emergency?',
    'Burst pipes, flooding, fire, gas, or shock go to the team at once. Same-day cleaning is a normal visit.',
  ],
];

const PACK_FAQ_KEYS = new Set(
  PACK_FAQ_PAIRS.map(([question, answer]) => `${norm(question)}\n${norm(answer)}`)
);

/** Exact starter policy sentences. Empty is unknown; these are not facts. */
const PACK_POLICY_TEXTS = [
  'M-Pesa and cash. Confirm other methods with the team if asked.',
  'Same-day Nairobi delivery for stocked items when available; countrywide shipping on request.',
  'We can hold items for pickup when we have the caller name and pickup time.',
  'Returns and exchanges follow shop policy. Confirm details with the team if unsure.',
  'Prices vary by title; special orders get a free quotation before you confirm.',
  'M-Pesa and cash after the visit unless agreed otherwise.',
  'We come to you within our service area. Confirm coverage in Train.',
  'Some jobs may need a booking deposit. Confirm with the team.',
  'Call ahead to reschedule or cancel. Same-day cancels may be noted for the team.',
  'Workmanship follows the job quote. Confirm details on site.',
  'True emergencies (burst, flood, fire, gas, shock) are prioritized when the team is available.',
];

const PACK_POLICY_KEYS = new Set(PACK_POLICY_TEXTS.map(norm));

/** name, price_range, notes for vertical-pack service rows. */
const PACK_SERVICES = [
  ['In-store & online sales', '', 'Browse and buy stocked items.'],
  ['Special orders / sourcing', 'Free quotation', 'Source hard-to-find titles on request.'],
  ['Delivery', '', 'Local and countrywide delivery when available.'],
  ['Home cleaning', 'Quoted on site', 'House, Airbnb, and general clean visits.'],
  ['Carpet, upholstery, mattress', 'Quoted on site', 'Couch, carpet, mattress, and fabric cleans.'],
  ['General repair / maintenance visit', 'Quoted on site', 'Diagnose and fix common household issues.'],
  ['Installation', 'Quoted on site', 'Install fixtures or equipment as listed in Train.'],
  ['Inspection / assessment', 'Quoted on site', 'On-site assessment before larger jobs.'],
];

const PACK_SERVICE_KEYS = new Set(
  PACK_SERVICES.map(([name, price, notes]) => `${norm(name)}\n${norm(price)}\n${norm(notes)}`)
);

const POLICY_TOPICS = {
  payment: 'Payment',
  returns: 'Returns',
  delivery: 'Delivery',
  deposit: 'Holds',
  cancellation: 'Cancellation',
  warranty: 'Warranty',
  other: 'Other policy',
};

function asArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asObject(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

function envelopeOf(row) {
  if (!row || typeof row !== 'object') return {};
  const nested = row.envelope || row.field_meta || row.meta;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
  return row;
}

function readSource(row) {
  const env = envelopeOf(row);
  const raw = String(env.source || env.provenance || '').trim().toLowerCase();
  return SOURCES.has(raw) ? raw : '';
}

function isConfirmed(row) {
  const env = envelopeOf(row);
  if (env.confirmed === true) return true;
  if (env.confirmed_by) return true;
  if (env.confirmed_at) return true;
  return false;
}

function isPackFaq(question, answer) {
  return PACK_FAQ_KEYS.has(`${norm(question)}\n${norm(answer)}`);
}

function isPackPolicyText(text) {
  return PACK_POLICY_KEYS.has(norm(text));
}

function isPackService(row) {
  if (!row || typeof row !== 'object') return false;
  const price = row.price_range || row.priceRange || row.price || '';
  return PACK_SERVICE_KEYS.has(`${norm(row.name)}\n${norm(price)}\n${norm(row.notes)}`);
}

/**
 * @returns {{ source: string, confirmed: boolean, fact: boolean, status: string }}
 * fact is only owner or an explicit confirm. seed and call_suggested are never fact.
 */
function classifyRecord(row, { packSeed = false } = {}) {
  const confirmed = isConfirmed(row);
  let source = readSource(row);
  if (!source && packSeed) source = 'seed';
  if (!source && confirmed) source = 'owner';
  if (!source) source = 'owner';

  const blocked = source === 'seed' || source === 'call_suggested' || source === 'inferred';
  const importPending = source === 'import' && !confirmed;
  const fact = !blocked && !importPending && (source === 'owner' || confirmed);

  let status = 'suggested';
  if (fact) {
    const raw = String(envelopeOf(row).status || '').trim().toLowerCase();
    status = raw === 'golden' && (source === 'owner' || confirmed) ? 'golden' : 'confirmed';
  }
  return { source, confirmed, fact, status };
}

function classifyFaq(faq) {
  const question = String(faq?.question || '').trim();
  const answer = String(faq?.answer || '').trim();
  const packSeed = isPackFaq(question, answer);
  const row = classifyRecord(faq, { packSeed });
  return { ...row, question, answer };
}

function classifyPolicyValue(text, meta) {
  const value = String(text || '').trim();
  if (!value) return { source: '', confirmed: false, fact: false, status: 'suggested', empty: true };
  const packSeed = isPackPolicyText(value);
  return { ...classifyRecord(meta || { source: packSeed ? 'seed' : '' }, { packSeed }), empty: false, text: value };
}

function policyMeta(policies, key) {
  const obj = asObject(policies);
  if (obj.provenance && typeof obj.provenance === 'object') return obj.provenance[key] || {};
  if (obj.field_meta && typeof obj.field_meta === 'object') return obj.field_meta[key] || {};
  const direct = obj[`${key}_source`] || obj[`${key}Source`];
  if (direct) return { source: direct };
  if (SOURCES.has(String(obj.source || '').toLowerCase())) return { source: obj.source };
  return {};
}

function factPolicyMap(policies) {
  const obj = asObject(policies);
  const out = {};
  const unknown = [];
  for (const [key, label] of Object.entries(POLICY_TOPICS)) {
    const text = String(obj[key] || '').trim();
    const row = classifyPolicyValue(text, policyMeta(obj, key));
    if (row.fact) out[key] = text;
    else unknown.push(label);
  }
  return { policies: out, unknown };
}

const HOLD_DENIAL =
  /\b(no holds?|do not hold|don't hold|cannot hold|can't hold|not holding|hatuweki|hatutoi hold)\b/i;

function holdRulesAllow(policies) {
  const obj = asObject(policies);
  const holds = obj.holds;
  if (holds && typeof holds === 'object') {
    const allowed = String(holds.allowed ?? holds.enabled ?? '').trim().toLowerCase();
    const row = classifyRecord(holds, { packSeed: false });
    if (allowed === 'no' || allowed === 'false') return false;
    if ((allowed === 'yes' || allowed === 'true') && row.fact) return true;
  }
  const deposit = String(obj.deposit || '').trim();
  const row = classifyPolicyValue(deposit, policyMeta(obj, 'deposit'));
  if (!row.fact) return false;
  if (HOLD_DENIAL.test(deposit)) return false;
  return true;
}

function factProducts(raw) {
  return asArray(raw).filter((row) => {
    if (!row || typeof row !== 'object') return false;
    if (!String(row.name || '').trim()) return false;
    return classifyRecord(row, { packSeed: false }).fact;
  });
}

function factServices(raw) {
  return asArray(raw).filter((row) => {
    if (!row || typeof row !== 'object') return false;
    if (!String(row.name || '').trim()) return false;
    return classifyRecord(row, { packSeed: isPackService(row) }).fact;
  });
}

function factFaqs(raw) {
  return asArray(raw)
    .map(classifyFaq)
    .filter((row) => row.fact && row.question && row.answer);
}

function unknownFaqTopics(raw) {
  return asArray(raw)
    .map(classifyFaq)
    .filter((row) => row.question && row.answer && !row.fact)
    .map((row) => `FAQ: ${row.question}`);
}

function holdOrdersEnabled(profile = {}) {
  if (!factProducts(profile.productCatalog).length) return false;
  return holdRulesAllow(profile.businessPolicies);
}

function confirmedSlotEnabled(profile = {}) {
  const obj = asObject(profile.businessPolicies);
  const mode = String(obj.booking_mode || obj.bookingMode || '').trim().toLowerCase();
  if (mode !== 'confirmed_slot') return false;
  const meta = obj.booking || obj.booking_meta || policyMeta(obj, 'booking_mode');
  return classifyRecord(
    typeof meta === 'object' && meta ? { ...meta, source: meta.source || obj.source } : meta,
    { packSeed: false }
  ).fact;
}

function formatUnknownSection(topics) {
  const list = [...new Set((topics || []).map((t) => String(t || '').trim()).filter(Boolean))];
  const lines = [
    'UNKNOWN (not confirmed by the owner. Do not state these as fact. Say you will confirm with the owner):',
  ];
  if (!list.length) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  for (const topic of list) lines.push(`- ${topic}`);
  lines.push(
    'For an UNKNOWN topic: admit you do not have it. Say: "Let me confirm with the owner." Do not guess, and do not use a pack seed as the answer.'
  );
  return lines.join('\n');
}

/**
 * Sections for llm_system_prompt. Seed FAQs are not GOLDEN. Seed policy lines
 * are removed from the fact block and listed under UNKNOWN.
 */
function buildCompileSections({
  faqs = [],
  policiesText = '',
  productsText = '',
  servicesText = '',
  productCatalog = null,
  businessPolicies = null,
} = {}) {
  const faqRows = asArray(faqs).map(classifyFaq).filter((row) => row.question && row.answer);
  const factFaqs = faqRows.filter((row) => row.fact);
  const unknown = faqRows.filter((row) => !row.fact).map((row) => `FAQ: ${row.question}`);

  let policyBody = String(policiesText || '').trim();
  if (businessPolicies) {
    const split = factPolicyMap(businessPolicies);
    const lines = [];
    for (const [key, label] of Object.entries(POLICY_TOPICS)) {
      if (split.policies[key]) lines.push(`- ${label}: ${split.policies[key]}`);
    }
    policyBody = lines.join('\n');
    for (const topic of split.unknown) {
      if (!unknown.includes(topic)) unknown.push(topic);
    }
  } else if (policyBody) {
    const kept = [];
    for (const line of policyBody.split('\n')) {
      const match = line.match(/^-\s*([^:]+):\s*(.+)$/);
      if (match && isPackPolicyText(match[2])) {
        const label = match[1].trim();
        if (!unknown.includes(label)) unknown.push(label);
        continue;
      }
      kept.push(line);
    }
    policyBody = kept.join('\n').trim();
  }

  let servicesBody = String(servicesText || '');
  if (servicesBody) {
    const kept = [];
    for (const line of servicesBody.split('\n')) {
      const seed = PACK_SERVICES.some(([name, , notes]) => {
        const hay = norm(line);
        return hay.includes(norm(name)) && hay.includes(norm(notes));
      });
      if (seed) {
        if (!unknown.includes('Services')) unknown.push('Services');
        continue;
      }
      kept.push(line);
    }
    servicesBody = kept.join('\n').trim();
  }

  let productsBody = String(productsText || '').trim();
  if (productCatalog) {
    const named = asArray(productCatalog).filter((row) => String(row?.name || '').trim());
    const rows = factProducts(productCatalog);
    if (named.length && !rows.length) {
      productsBody = '';
      if (!unknown.includes('Product catalogue')) unknown.push('Product catalogue');
    } else if (rows.length && rows.length < named.length) {
      productsBody = rows
        .map((row) => {
          const price = String(row.price || row.price_range || row.priceRange || '').trim();
          return price ? `- ${row.name} - ${price}` : `- ${row.name}`;
        })
        .join('\n');
      if (!unknown.includes('Product catalogue')) unknown.push('Product catalogue');
    }
  }

  const faqBlock = factFaqs.length
    ? factFaqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')
    : '(none confirmed)';

  return {
    faqBlock,
    policiesText: policyBody || '(none confirmed)',
    productsText: productsBody || '(none confirmed)',
    servicesText: servicesBody,
    unknownBlock: formatUnknownSection(unknown),
    unknownTopics: unknown,
    holdsAvailable: holdOrdersEnabled({
      productCatalog: productCatalog || [],
      businessPolicies: businessPolicies || {},
    }),
    confirmedSlotsAvailable: confirmedSlotEnabled({
      businessPolicies: businessPolicies || {},
    }),
  };
}

function speechFactText(profile = {}) {
  const policies = factPolicyMap(profile.businessPolicies).policies;
  const products = factProducts(profile.productCatalog).map((row) => ({
    name: row.name,
    price: row.price || row.price_range || row.priceRange || '',
    notes: row.notes || '',
  }));
  const services = factServices(profile.servicesCatalog).map((row) => ({
    name: row.name,
    price_range: row.price_range || row.priceRange || '',
    notes: row.notes || '',
  }));
  const faqs = factFaqs(profile.faqs).map((row) => ({
    question: row.question,
    answer: row.answer,
  }));
  return JSON.stringify({
    businessName: profile.businessName || profile.business_name || '',
    hours: profile.hoursSchedule || profile.hours_schedule || profile.businessHours || profile.business_hours || '',
    locations: profile.businessLocations || profile.business_locations || '',
    bulletin: profile.dailyBulletin || profile.daily_bulletin || '',
    team: profile.teamDirectory || profile.team_directory || '',
    social: profile.socialHandles || profile.social_handles || '',
    notes: profile.servicesNotes || profile.servicesOffered || profile.services_offered || '',
    policies,
    products,
    services,
    faqs,
  });
}

module.exports = {
  PACK_POLICY_TEXTS,
  PACK_FAQ_PAIRS,
  norm,
  classifyRecord,
  classifyFaq,
  isPackFaq,
  isPackPolicyText,
  isPackService,
  factPolicyMap,
  factProducts,
  factServices,
  factFaqs,
  unknownFaqTopics,
  holdRulesAllow,
  holdOrdersEnabled,
  confirmedSlotEnabled,
  formatUnknownSection,
  buildCompileSections,
  speechFactText,
  POLICY_TOPICS,
};
