// Contextual misunderstanding detection and bounded repair strategy.

function isRepairSignal(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return false;
  return [
    /\b(that'?s not what i (said|meant|asked))\b/,
    /\b(you (misheard|misunderstood) me)\b/,
    /\b(i said|i meant|not that one|wrong name|that is wrong)\b/,
    /\b(no[, ]+not\b)/,
    /\b(hujanielewa|sijasema hivyo|nilisema|sio hiyo|si hivyo)\b/,
    /\b(umeskia vibaya|umenielewa vibaya)\b/,
  ].some((pattern) => pattern.test(value));
}

function repairStrategy(failureCount) {
  const count = Number(failureCount || 0);
  if (count <= 0) {
    return {
      id: 'none',
      instruction: 'No repair is needed.',
    };
  }
  if (count === 1) {
    return {
      id: 'contextual_clarification',
      instruction:
        'Acknowledge briefly and ask a contextual either/or or best-guess clarification. Do not restart discovery.',
    };
  }
  if (count === 2) {
    return {
      id: 'simplify',
      instruction:
        'Explain or ask again using simpler words and one short question. Do not repeat the same sentence.',
    };
  }
  return {
    id: 'alternative_or_human',
    instruction:
      'Stop repeating the failed question. Offer an alternative route or a justified human handoff.',
  };
}

function applyRepairObservation(state, { text, lastAgentText = '' } = {}) {
  const next = structuredClone(state);
  if (!isRepairSignal(text)) return next;
  next.repair.failureCount = Number(next.repair.failureCount || 0) + 1;
  next.repair.lastTrigger = String(text || '').trim();
  next.repair.lastAgentText = String(lastAgentText || '').trim();
  next.repair.strategy = repairStrategy(next.repair.failureCount).id;
  next.conversation.stage = 'repair';
  return next;
}

function markRepairProgress(state) {
  const next = structuredClone(state);
  if (!next.repair.failureCount) return next;
  next.repair.failureCount = 0;
  next.repair.lastTrigger = null;
  next.repair.lastAgentText = null;
  next.repair.strategy = 'none';
  return next;
}

function formatRepairForPrompt(state) {
  const count = Number(state?.repair?.failureCount || 0);
  const strategy = repairStrategy(count);
  return [
    `REPAIR STATE: failures=${count}; strategy=${strategy.id}.`,
    strategy.instruction,
  ].join(' ');
}

module.exports = {
  isRepairSignal,
  repairStrategy,
  applyRepairObservation,
  markRepairProgress,
  formatRepairForPrompt,
};
