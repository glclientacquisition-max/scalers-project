// Normalize tenant business_policies for live ground truth.

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
  const out = { ...empty };
  for (const key of Object.keys(empty)) {
    out[key] = String(obj[key] || '').trim();
  }
  return out;
}

function policiesHaveContent(policies) {
  return Object.values(normalizePolicies(policies)).some(Boolean);
}

function formatPoliciesBlock(policies) {
  const p = normalizePolicies(policies);
  const lines = [];
  for (const [key, label] of Object.entries(POLICY_LABELS)) {
    if (p[key]) lines.push(`- ${label}: ${p[key]}`);
  }
  return lines.length ? lines.join('\n') : '(none listed)';
}

module.exports = {
  POLICY_LABELS,
  normalizePolicies,
  policiesHaveContent,
  formatPoliciesBlock,
};
