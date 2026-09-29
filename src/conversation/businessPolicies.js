// Normalize tenant business_policies for live ground truth.

const { formatCoverageList, parseCoverageAreas } = require('./coverageAreas');

const POLICY_LABELS = {
  payment: 'Payment',
  returns: 'Returns / exchanges',
  delivery: 'Delivery / service area',
  deposit: 'Deposits / holds',
  cancellation: 'Cancellation',
  warranty: 'Warranty / guarantee',
  other: 'Other',
};

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function normalizePolicies(raw) {
  const empty = {
    returns: '',
    delivery: '',
    payment: '',
    deposit: '',
    cancellation: '',
    warranty: '',
    other: '',
  };
  if (!raw) return empty;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return empty;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return empty;
  const out = { ...empty, coverage_areas: null };
  for (const key of Object.keys(empty)) {
    out[key] = String(obj[key] || '').trim();
  }
  if (Array.isArray(obj.coverage_areas)) {
    out.coverage_areas = parseCoverageAreas(obj.coverage_areas);
  }
  return out;
}

function policiesHaveContent(policies) {
  const p = normalizePolicies(policies);
  if (Array.isArray(p.coverage_areas) && p.coverage_areas.length) return true;
  return Object.entries(POLICY_LABELS).some(([key]) => Boolean(p[key]));
}

function formatPoliciesBlock(policies) {
  const p = normalizePolicies(policies);
  const lines = [];
  let anyContent = false;
  for (const [key, label] of Object.entries(POLICY_LABELS)) {
    if (p[key]) {
      anyContent = true;
      lines.push(`- ${label}: ${p[key]}`);
    } else {
      lines.push(
        `- ${label}: (not on file — admit you do not have that detail; never invent; do not force name capture)`
      );
    }
  }
  if (Array.isArray(p.coverage_areas)) {
    lines.push(
      `- Coverage: ${formatCoverageList(p.coverage_areas) || '(none listed)'}`
    );
    lines.push(
      'COVERAGE RULE: The Coverage line is the only service area. Delivery text is timing and other instructions.'
    );
  }
  if (!anyContent && !Array.isArray(p.coverage_areas)) {
    return [
      '(no policy text on file)',
      'POLICY RULE: For any policy ask (returns, refunds, payment, etc.), say you do not have that detail. Offer to save a note ONLY if the caller asks. Never invent policy wording. Never force name/reason capture.',
    ].join('\n');
  }
  lines.push(
    'POLICY RULE: Answer only from lines that have real text. If the asked policy is "(not on file)", admit unknown. Do not invent. Do not ask for a name unless the caller wants a saved note.'
  );
  return lines.join('\n');
}

/**
 * Resolve a policy answer from structured policies for an asked key / utterance.
 * @returns {{key: string, text: string}|null} text empty when key known but not on file
 */
function lookupPolicy(policies, asked = '') {
  const p = normalizePolicies(policies);
  const value = String(asked || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return null;
  const aliases = {
    returns: ['return', 'returns', 'refund', 'exchange', 'exchanges'],
    delivery: ['delivery', 'deliver', 'shipping', 'ship', 'courier'],
    payment: ['payment', 'pay', 'mpesa', 'm-pesa', 'cash', 'card'],
    deposit: ['deposit', 'hold deposit', 'booking fee'],
    cancellation: ['cancel', 'cancellation', 'reschedule'],
    warranty: ['warranty', 'guarantee'],
    other: ['other', 'policy'],
  };
  for (const [key, words] of Object.entries(aliases)) {
    if (words.some((w) => value.includes(w))) {
      return { key, text: p[key] || '' };
    }
  }
  return null;
}

module.exports = {
  POLICY_LABELS,
  normalizePolicies,
  policiesHaveContent,
  formatPoliciesBlock,
  lookupPolicy,
};
