// Deterministic call summary + intent collection from Brain state (no live audio).
// Gemini already sees STT text mid-call; post-call we persist structured desk fields.

const { normalizePrimaryIntent } = require('./callResolution');
const {
  entityValue,
  isBackchannelOrFragment,
  isPlausibleCallerName,
} = require('./entityExtraction');

function clean(value, max = 280) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeCallerName(state) {
  const raw = clean(state.caller?.name || entityValue(state.entities?.name), 80);
  return isPlausibleCallerName(raw) ? raw : null;
}

function safeGoalDescription(raw) {
  const goal = clean(raw, 160);
  if (!goal || isBackchannelOrFragment(goal)) return '';
  return goal;
}

/**
 * @param {{
 *   brainState?: object|null,
 *   toolResults?: Array<object>,
 *   transcriptLines?: string[],
 * }} opts
 */
function deriveCallSummary(opts = {}) {
  const state = opts.brainState || {};
  const results = Array.isArray(opts.toolResults)
    ? opts.toolResults
    : Array.isArray(state.actions?.lastResults)
      ? state.actions.lastResults
      : [];

  let primaryIntent =
    normalizePrimaryIntent(state.intent) ||
    normalizePrimaryIntent(opts.primaryIntent) ||
    null;
  if (
    (state.handoff?.requested || state.handoff?.required) &&
    (!primaryIntent || primaryIntent === 'general_enquiry')
  ) {
    primaryIntent = 'human';
  }

  const products = [
    entityValue(state.entities?.product),
    entityValue(state.entities?.requestedItem),
  ].filter(Boolean);

  const actions = [];
  const instructions = [];
  for (const result of results) {
    if (
      result.action === 'create_service_request' &&
      (result.status === 'succeeded' || result.status === 'updated')
    ) {
      const type = result.requestType || result.value?.type || 'request';
      const item = result.value?.item || products[0] || '';
      const when = result.value?.whenText || result.value?.when_text || '';
      actions.push(clean([type, item, when].filter(Boolean).join('. '), 160));
      if (when) instructions.push(clean(`Pickup/when: ${when}`, 120));
      if (result.value?.notes) instructions.push(clean(result.value.notes, 160));
    }
    if (result.action === 'escalate' && result.status === 'succeeded') {
      actions.push(
        result.soft ? 'Escalation noted for desk follow-up' : 'Escalation sent to team'
      );
    }
  }

  const name = safeCallerName(state);
  const goal = safeGoalDescription(state.goal?.description || '');
  const reason = buildOwnerReason({
    callerName: name,
    primaryIntent,
    goal,
    products,
    results,
  });
  const bits = [];
  if (primaryIntent) bits.push(`Intent: ${primaryIntent}`);
  if (name) bits.push(`Caller: ${name}`);
  if (goal) bits.push(`Goal: ${goal}`);
  if (products.length) bits.push(`Products: ${products.join(', ')}`);
  if (actions.length) bits.push(`Actions: ${actions.join('; ')}`);
  if (instructions.length) bits.push(`Instructions: ${instructions.join('; ')}`);

  const text =
    bits.join('. ') ||
    clean(
      Array.isArray(opts.transcriptLines)
        ? opts.transcriptLines.slice(-4).join(' | ')
        : '',
      240
    ) ||
    'Call completed.';

  return {
    text: clean(text, 400),
    reason,
    primaryIntent,
    products,
    actions,
    instructions,
    callerName: name || null,
    language: state.language?.current || null,
  };
}

function buildOwnerReason({ callerName, primaryIntent, goal, products, results }) {
  const who = callerName || 'Caller';
  const rows = Array.isArray(results) ? results : [];
  const hold = rows.find(
    (row) =>
      row.action === 'create_service_request' &&
      (row.status === 'succeeded' || row.status === 'updated')
  );
  const visit = rows.find(
    (row) =>
      (row.action === 'create_appointment' ||
        row.action === 'update_appointment') &&
      (row.status === 'succeeded' || row.status === 'updated')
  );

  if (hold) {
    const item = hold.value?.item || products?.[0] || '';
    const when = hold.value?.whenText || hold.value?.when_text || '';
    return clean([`${who} left a hold`, item, when].filter(Boolean).join('. '), 220);
  }
  if (visit) {
    const service =
      visit.value?.serviceName ||
      visit.value?.service ||
      visit.record?.service_name ||
      '';
    const when = visit.value?.whenText || visit.value?.when_text || '';
    const verb =
      visit.action === 'update_appointment' ? 'updated a visit' : 'booked a visit';
    return clean([`${who} ${verb}`, service, when].filter(Boolean).join('. '), 220);
  }
  if (primaryIntent === 'human') {
    return clean(`${who} needs you to return the call.`, 220);
  }
  if (goal) {
    return clean(`${who} asked about ${goal.replace(/\.$/, '')}.`, 220);
  }
  if (primaryIntent === 'hours_open') {
    return clean(`${who} asked about hours.`, 220);
  }
  if (primaryIntent === 'product_inquiry' && products?.[0]) {
    return clean(`${who} asked about ${products[0]}.`, 220);
  }
  return clean(`${who} called.`, 220);
}

module.exports = {
  deriveCallSummary,
};
