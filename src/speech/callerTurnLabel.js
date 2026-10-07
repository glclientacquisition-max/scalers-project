// Labels a flushed caller turn for Brain. Voice does not choose the goal.
// Brain PR #586 (`isRejectedGoalText`) honors `unfinished`, `weak`, and
// `weakStt` on observe. Kiswahili stems stay in Brain. This file only
// forwards the signals turn-taking already has.

const { utteranceLooksIncomplete } = require('./turnTaking');

function helperFrom(mod, names) {
  if (!mod) return null;
  for (const name of names) {
    if (typeof mod[name] === 'function') return mod[name];
  }
  return null;
}

function brainUnfinished(text) {
  let dedicated = null;
  try {
    dedicated = helperFrom(require('../conversation/unfinishedUtterance'), [
      'isUnfinishedCallerUtterance',
      'utteranceUnfinished',
      'callerUtteranceUnfinished',
    ]);
  } catch {
    dedicated = null;
  }
  if (dedicated) return dedicated(text) === true;

  let stem = null;
  try {
    stem = helperFrom(require('../conversation/entityExtraction'), [
      'isUnfinishedCallerStem',
      'isUnfinishedCallerUtterance',
    ]);
  } catch {
    stem = null;
  }
  if (stem) return stem(text) === true;
  return null;
}

function passedFlags(turnEnd) {
  const end = turnEnd && typeof turnEnd === 'object' ? turnEnd : {};
  return {
    unfinished: end.unfinished === true,
    weak: end.weak === true,
    weakStt: end.weakStt === true,
  };
}

/**
 * @param {{ text?: string, turnEnd?: { unfinished?: boolean, weak?: boolean, weakStt?: boolean } }} [opts]
 * @returns {{ text: string, unfinished: boolean, weak: boolean, weakStt: boolean }}
 */
function labelFlushedCallerTurn(opts = {}) {
  const spoken = String(opts.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const flags = passedFlags(opts.turnEnd);
  const fromBrain = brainUnfinished(spoken);
  const fromVoice = utteranceLooksIncomplete(spoken);
  return {
    text: spoken,
    unfinished: Boolean(flags.unfinished || fromBrain === true || fromVoice),
    weak: flags.weak,
    weakStt: flags.weakStt,
  };
}

/**
 * Observe payload for Brain. Adds `unfinished`, `weak`, and `weakStt`.
 * Does not set a goal.
 * @param {object} [input]
 * @param {{ turnEnd?: { unfinished?: boolean, weak?: boolean, weakStt?: boolean } }} [opts]
 */
function observeCallerInput(input = {}, opts = {}) {
  const base = input && typeof input === 'object' ? input : {};
  const labeled = labelFlushedCallerTurn({
    text: base.text,
    turnEnd: {
      unfinished: opts.turnEnd?.unfinished === true || base.unfinished === true,
      weak: opts.turnEnd?.weak === true || base.weak === true,
      weakStt: opts.turnEnd?.weakStt === true || base.weakStt === true,
    },
  });
  return {
    ...base,
    text: labeled.text,
    unfinished: labeled.unfinished,
    weak: labeled.weak,
    weakStt: labeled.weakStt,
  };
}

module.exports = {
  labelFlushedCallerTurn,
  observeCallerInput,
};
