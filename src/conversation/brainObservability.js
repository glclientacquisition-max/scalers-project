// Structured Brain traces for debugging decisions without logging caller PII.

const { entityValue } = require('./entityExtraction');

const PII_ENTITY_KEYS = new Set(['name', 'phone', 'email']);

function safeEntitySummary(entities = {}) {
  return Object.fromEntries(
    Object.entries(entities)
      .filter(([key]) => !PII_ENTITY_KEYS.has(key))
      .map(([key, raw]) => [
        key,
        {
          value: entityValue(raw).slice(0, 120),
          confirmed: Boolean(raw && typeof raw === 'object' && raw.confirmed),
          source:
            raw && typeof raw === 'object' ? String(raw.source || 'unknown') : 'legacy',
        },
      ])
      .filter(([, value]) => value.value)
  );
}

function buildBrainTrace({
  callSid,
  phase,
  state,
  decision,
  toolResults = [],
} = {}) {
  return {
    event: 'brain_turn',
    version: 1,
    callSid: String(callSid || 'unknown'),
    phase: String(phase || 'decision'),
    turn: Number(state?.conversation?.turnCount || 0),
    stage: String(state?.conversation?.stage || 'unknown'),
    intent: String(state?.intent || 'unknown'),
    goal: String(state?.goal?.primary || 'unknown'),
    goalStatus: String(state?.goal?.status || 'unknown'),
    missingSlots: Array.isArray(state?.goal?.missingSlots)
      ? [...state.goal.missingSlots]
      : [],
    entities: safeEntitySummary(state?.entities),
    language: {
      current: String(state?.language?.current || 'unknown'),
      detected: String(state?.language?.detected || 'unknown'),
      confidence: Number(state?.language?.confidence || 0),
      switches: Number(state?.language?.switchCount || 0),
    },
    repairFailures: Number(state?.repair?.failureCount || 0),
    nextBestAction: String(
      decision?.action || state?.resolution?.nextBestAction || 'unknown'
    ),
    decisionReason: String(
      decision?.reason || state?.resolution?.reason || ''
    ).slice(0, 300),
    toolResults: (Array.isArray(toolResults) ? toolResults : []).map((result) => ({
      action: String(result.action || ''),
      status: String(result.status || ''),
      reason: String(result.reason || '').slice(0, 200),
    })),
    resolutionStatus: String(state?.resolution?.status || 'unresolved'),
  };
}

function logBrainTrace(input) {
  const trace = buildBrainTrace(input);
  console.log(`[brain-trace] ${JSON.stringify(trace)}`);
  return trace;
}

module.exports = {
  PII_ENTITY_KEYS,
  safeEntitySummary,
  buildBrainTrace,
  logBrainTrace,
};
