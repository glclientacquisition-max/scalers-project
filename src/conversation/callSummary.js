// Deterministic call summary + intent collection from Brain state (no live audio).
// Gemini already sees STT text mid-call; post-call we persist structured desk fields.

const {
  highWaterPrimaryIntent,
  hangupResults,
  normalizePrimaryIntent,
  VISIT_REQUESTED_NOTE,
  resultStatus,
} = require('./callResolution');
const {
  entityValue,
  callerGoalText,
  isPlausibleCallerName,
} = require('./entityExtraction');

function clean(value, max = 280) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeCallerName(state) {
  // CALLER_INFO_P1: the owner summary carries a confirmed name only.
  if (require('./callerInfoTrust').on()) {
    const held = state.caller?.nameConfirmed ? clean(state.caller?.name, 80) : '';
    return held && isPlausibleCallerName(held) ? held : null;
  }
  const raw = clean(state.caller?.name || entityValue(state.entities?.name), 80);
  return isPlausibleCallerName(raw) ? raw : null;
}

function safeGoalDescription(raw) {
  const goal = clean(callerGoalText(raw), 160);
  if (!goal) return '';
  // BRAIN_CALL_FIXES_D199 (HD_1677e57f73f9 4): "Alvin asked about that's all."
  const fixes = require('./callFixesD199');
  if (fixes.callFixesD199Enabled() && fixes.notAGoal(goal)) return '';
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
  const results = hangupResults(state, opts.toolResults);

  let primaryIntent =
    highWaterPrimaryIntent({
      liveIntent: state.intent || opts.primaryIntent,
      results,
    }) ||
    normalizePrimaryIntent(state.intent) ||
    normalizePrimaryIntent(opts.primaryIntent) ||
    null;
  if (
    (state.handoff?.requested || state.handoff?.required) &&
    (!primaryIntent || primaryIntent === 'general_enquiry')
  ) {
    primaryIntent = 'human';
  }

  const fixesD199 = require('./callFixesD199');
  const products = [
    entityValue(state.entities?.product),
    entityValue(state.entities?.requestedItem),
  ]
    .filter(Boolean)
    // BRAIN_CALL_FIXES_D199 (Aris HD_d3900cbf2b2d 8): "A mood. Diary" → "A mood Diary".
    .map((item) => (fixesD199.callFixesD199Enabled() ? fixesD199.joinBrokenPhrase(item) : item));

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
    if (result.action === 'escalate' && result.status === 'succeeded' && !result.soft) {
      actions.push('Escalation sent to team');
    }
    if (
      result.action === 'escalate' &&
      (result.status === 'failed' || (result.status === 'succeeded' && result.soft))
    ) {
      actions.push('Needs human. Notify failed.');
    }
  }

  // BRAIN_CONFIRMED_COVERAGE: places the owner still has to confirm.
  // state.needs exists only when the flag is on.
  for (const line of require('./confirmedCoverage').openCoverageNeedLines(state)) {
    if (!instructions.includes(line)) instructions.push(line);
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

  // CALLER_INFO_P1: receipts beat the summary (trustP1.validateSummary).
  let checkedText = clean(text, 400);
  if (require('./callerInfoTrust').on()) {
    const ok = require('./trustP1').validateSummary(checkedText, results);
    if (!ok) checkedText = clean(bits.filter((b) => !/^Actions:|^Products:/.test(b)).join('. ') || 'Call completed.', 400);
  }
  return {
    text: checkedText,
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
    // CALLER_INFO_P1: the reason follows the saved request type.
    if (require('./callerInfoTrust').on()) {
      const type = String(hold.requestType || hold.value?.type || '').toLowerCase();
      const verb = type === 'hold' || type === 'hold_or_pickup' ? 'left a hold'
        : type === 'order' ? 'placed an order'
        : /complaint/.test(String(item).toLowerCase()) || /complaint/i.test(String(hold.value?.notes || '')) ? 'made a complaint'
        : /change/.test(type) || /change/.test(String(item)) ? 'asked for a change (needs you)'
        : type === 'callback' ? 'asked for a call back'
        : 'made an enquiry';
      return clean([`${who} ${verb}`, item && !/complaint|change/.test(verb) ? item : '', when].filter(Boolean).join('. '), 220);
    }
    return clean([`${who} left a hold`, item, when].filter(Boolean).join('. '), 220);
  }
  if (visit) {
    const service =
      visit.value?.serviceName ||
      visit.value?.service ||
      visit.record?.service_name ||
      '';
    const when = visit.value?.whenText || visit.value?.when_text || '';
    const status = resultStatus(visit, 'requested');
    if (status === 'cancelled') {
      return clean(
        [`${who} cancelled a visit`, service, when].filter(Boolean).join('. '),
        220
      );
    }
    if (status === 'confirmed' || status === 'done') {
      const verb =
        visit.action === 'update_appointment' ? 'updated a visit' : 'confirmed a visit';
      return clean([`${who} ${verb}`, service, when].filter(Boolean).join('. '), 220);
    }
    return VISIT_REQUESTED_NOTE;
  }
  if (primaryIntent === 'human') {
    return clean(`${who} needs you to return the call.`, 220);
  }
  if (goal) {
    return clean(`${who} asked about ${goal.replace(/[.?]+$/g, '')}.`, 220);
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
