// Labels a flushed caller turn for Brain. Voice does not choose the goal.
// Kiswahili unfinished stems stay in Brain (`unfinishedUtterance.js`) when
// that module lands. This file only forwards the flag.

const { utteranceLooksIncomplete } = require('./turnTaking');

function brainUnfinished(text) {
  let mod;
  try {
    mod = require('../conversation/unfinishedUtterance');
  } catch {
    return null;
  }
  const fn =
    mod.isUnfinishedCallerUtterance ||
    mod.utteranceUnfinished ||
    mod.callerUtteranceUnfinished;
  if (typeof fn !== 'function') return null;
  return fn(text) === true;
}

/**
 * @param {{ text?: string, turnEnd?: { unfinished?: boolean } }} [opts]
 * @returns {{ text: string, unfinished: boolean }}
 */
function labelFlushedCallerTurn(opts = {}) {
  const spoken = String(opts.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const fromEnd = opts.turnEnd?.unfinished === true;
  const fromBrain = brainUnfinished(spoken);
  const fromVoice = utteranceLooksIncomplete(spoken);
  return {
    text: spoken,
    unfinished: Boolean(fromEnd || fromBrain === true || fromVoice),
  };
}

/**
 * Observe payload. Adds `unfinished`. Does not set a goal.
 * @param {object} [input]
 * @param {{ turnEnd?: { unfinished?: boolean } }} [opts]
 */
function observeCallerInput(input = {}, opts = {}) {
  const base = input && typeof input === 'object' ? input : {};
  const labeled = labelFlushedCallerTurn({
    text: base.text,
    turnEnd: opts.turnEnd,
  });
  return {
    ...base,
    text: labeled.text,
    unfinished: Boolean(labeled.unfinished || base.unfinished),
  };
}

module.exports = {
  labelFlushedCallerTurn,
  observeCallerInput,
};
