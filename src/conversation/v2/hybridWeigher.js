'use strict';
/**
 * Hybrid confidence weigher (path H) — picks which Train mouth path to take.
 * Model plaintext never TTS. agreement() is log/metrics only (not a speak gate).
 * Fail-fast / HARD_CAP stay owned by machine.js / modelShadow.js.
 *
 * Design: research/2026-10-23_hybrid-weigher-design.md
 * Brief:  ship-briefs/2026-10-23_brain_hybrid-weigher.md
 */

const READ_TOOLS = new Set(['get_price', 'check_availability', 'get_hours']);
const WRITE_TOOLS = new Set([
  // C7 modelShadow names
  'propose_booking', 'propose_order', 'propose_quote', 'propose_callback',
  // machine consultModel / catalogue names
  'create_booking', 'create_order', 'create_handoff', 'update_booking', 'cancel_booking', 'log_complaint', 'save_caller_name',
]);

const ACTION = Object.freeze({
  SPEAK_RULES_NOW: 'SPEAK_RULES_NOW',
  SEED_THEN_SPEAK: 'SEED_THEN_SPEAK',
  WAIT_BRIEF: 'WAIT_BRIEF',
  SPEAK_RULES_DEGRADE: 'SPEAK_RULES_DEGRADE',
  HONEST_MISS: 'HONEST_MISS',
  ESCALATE: 'ESCALATE',
  C1_SKIP: 'C1_SKIP',
});

const TRACE = Object.freeze({
  rules_faq: 'rules_faq',
  rules_train: 'rules_train',
  seed_r7a: 'seed_r7a',
  wait: 'wait',
  rules_degrade: 'rules_degrade',
  honest_miss: 'honest_miss',
  escalate: 'escalate',
  c1_skip: 'c1_skip',
});

function firstOkCall(mc, toolSet) {
  if (!mc || !Array.isArray(mc.calls)) return null;
  for (let i = 0; i < mc.calls.length; i++) {
    const c = mc.calls[i];
    const check = mc.checks && mc.checks[i];
    if (!check || !check.ok) continue;
    if (!toolSet.has(c.name)) continue;
    return { tool: c.name, args: (c.args && typeof c.args === 'object') ? c.args : {}, index: i };
  }
  return null;
}

function hasAnyCalls(mc) {
  return !!(mc && Array.isArray(mc.calls) && mc.calls.length);
}

/**
 * Classify model band from consult result (or null after fail-fast).
 * Dual-timeout honesty: answeredBy=none + empty calls → ABSENT.
 */
function classifyModelStrength(mc, { mouthFailFast = false } = {}) {
  if (mouthFailFast && !mc) return 'ABSENT';
  if (!mc) return 'ABSENT';
  if (mc.answeredBy === 'none' && !hasAnyCalls(mc)) return 'ABSENT';
  if (mc.timedOut && !hasAnyCalls(mc)) return 'ABSENT';
  if (mc.__pending) return 'PENDING';
  const write = firstOkCall(mc, WRITE_TOOLS);
  const read = firstOkCall(mc, READ_TOOLS);
  if (write && !read) return 'VALID_WRITE';
  if (read) return 'VALID_READ';
  if (hasAnyCalls(mc)) return 'INVALID';
  return 'ABSENT';
}

function classifyRulesStrength({ faqScore = null, hollow = false } = {}) {
  if (faqScore != null && faqScore >= 0.7) return 'FAQ_HARD';
  if (!hollow) return 'TRAIN_TRUE';
  return 'HOLLOW';
}

/**
 * Pure weigher. Highest discrete priority wins.
 *
 * @param {object} input
 * @param {number|null} [input.faqScore]
 * @param {boolean} [input.hollow] — rulesMouthWouldHollow(u)
 * @param {object|null} [input.mc] — consultModel / consultModelForMouth result
 * @param {boolean} [input.mouthFailFast]
 * @param {number} [input.repairs]
 * @param {boolean} [input.factMissing] — validated read but Train fact absent (e.g. no price.say)
 * @param {boolean} [input.seedAvailable] — dry validatedReadSeeds would override (R7 hollow OR area unbound)
 * @param {boolean|null} [input.agreementAgree] — log only; never gates mouth
 */
function weighHybridTurn(input = {}) {
  const faqScore = input.faqScore == null ? null : Number(input.faqScore);
  const hollow = !!input.hollow;
  const mc = input.mc || null;
  const mouthFailFast = !!input.mouthFailFast;
  const repairs = Number(input.repairs || 0);
  const factMissing = !!input.factMissing;
  const seedAvailable = !!input.seedAvailable;
  const agreementAgree = input.agreementAgree == null ? null : !!input.agreementAgree;

  const rules_strength = classifyRulesStrength({ faqScore, hollow });
  const model_strength = classifyModelStrength(mc, { mouthFailFast });

  const base = {
    rules_strength,
    model_strength,
    agreementAgree,
    mouthFailFast,
    repairs,
    factMissing,
    seedAvailable,
  };

  // Pri 100 — FAQ_HARD never overridden by model
  if (rules_strength === 'FAQ_HARD') {
    return {
      ...base,
      action: ACTION.SPEAK_RULES_NOW,
      trace: TRACE.rules_faq,
      priority: 100,
      applyR7aSeed: false,
      escalate: false,
    };
  }

  // Pri 80 / 40 — R7a would seed (hollow override OR unbound area coverage)
  // Preserves Kericho class even when coverage intent makes hollow=false.
  if (model_strength === 'VALID_READ' && seedAvailable && mc) {
    if (factMissing) {
      return {
        ...base,
        action: ACTION.HONEST_MISS,
        trace: TRACE.honest_miss,
        priority: 40,
        applyR7aSeed: true,
        escalate: false,
      };
    }
    return {
      ...base,
      action: ACTION.SEED_THEN_SPEAK,
      trace: TRACE.seed_r7a,
      priority: 80,
      applyR7aSeed: true,
      escalate: false,
    };
  }

  // Pri 90 — TRAIN_TRUE / non-hollow rules mouth (fixture f)
  if (rules_strength === 'TRAIN_TRUE') {
    if (model_strength === 'VALID_WRITE') {
      return {
        ...base,
        action: ACTION.C1_SKIP,
        trace: TRACE.c1_skip,
        priority: 0,
        applyR7aSeed: false,
        escalate: false,
      };
    }
    return {
      ...base,
      action: ACTION.SPEAK_RULES_NOW,
      trace: TRACE.rules_train,
      priority: 90,
      applyR7aSeed: false,
      escalate: false,
    };
  }

  // Hollow, no seed ——

  if (model_strength === 'VALID_WRITE') {
    return {
      ...base,
      action: ACTION.C1_SKIP,
      trace: TRACE.c1_skip,
      priority: 0,
      applyR7aSeed: false,
      escalate: false,
    };
  }

  // Pri 20 — repairs≥2 hollow (Alvin lock)
  if (repairs >= 2) {
    return {
      ...base,
      action: ACTION.ESCALATE,
      trace: TRACE.escalate,
      priority: 20,
      applyR7aSeed: false,
      escalate: true,
    };
  }

  // Pri 50 — fail-fast / absent / invalid → rules degrade
  return {
    ...base,
    action: ACTION.SPEAK_RULES_DEGRADE,
    trace: TRACE.rules_degrade,
    priority: 50,
    applyR7aSeed: false,
    escalate: false,
  };
}

function shouldApplyR7aSeed(decision) {
  return !!(decision && decision.applyR7aSeed);
}

module.exports = {
  weighHybridTurn,
  shouldApplyR7aSeed,
  classifyModelStrength,
  classifyRulesStrength,
  firstOkCall,
  READ_TOOLS,
  WRITE_TOOLS,
  ACTION,
  TRACE,
};
