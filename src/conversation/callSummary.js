// Deterministic call summary + intent collection from Brain state (no live audio).
// Gemini already sees STT text mid-call; post-call we persist structured desk fields.

const { normalizePrimaryIntent } = require('./callResolution');
const { entityValue } = require('./entityExtraction');

function clean(value, max = 280) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
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

  const primaryIntent =
    normalizePrimaryIntent(state.intent) ||
    normalizePrimaryIntent(opts.primaryIntent) ||
    null;

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
      actions.push(clean([type, item, when].filter(Boolean).join(' — '), 160));
      if (when) instructions.push(clean(`Pickup/when: ${when}`, 120));
      if (result.value?.notes) instructions.push(clean(result.value.notes, 160));
    }
    if (result.action === 'escalate' && result.status === 'succeeded') {
      actions.push(
        result.soft ? 'Escalation noted for desk follow-up' : 'Escalation sent to team'
      );
    }
  }

  const name = clean(state.caller?.name || entityValue(state.entities?.name), 80);
  const goal = clean(state.goal?.description || '', 160);
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
    primaryIntent,
    products,
    actions,
    instructions,
    callerName: name || null,
    language: state.language?.current || null,
  };
}

module.exports = {
  deriveCallSummary,
};
