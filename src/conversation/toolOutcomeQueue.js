// A tool outcome (booking, callback) that landed after the caller barged in.
// The barged turn does not speak it; the next turn that replies does.
// Port of the #609 febe7709 idea (HD_ee813bcf6248 t15: the appointment was
// created at 16:47:30 EAT, the reply was discarded, the caller was never told).

function outcomeLine(line) {
  return String(line ?? '').replace(/\s+/g, ' ').trim();
}

/** Remember the unspoken outcome on the call's brain state. */
function queueToolOutcome(state, line) {
  const text = outcomeLine(line);
  if (!state || typeof state !== 'object' || !text) return '';
  if (!state.conversation || typeof state.conversation !== 'object') state.conversation = {};
  state.conversation.pendingToolOutcome = text;
  return text;
}

/** Take (and clear) the owed outcome. Empty when nothing is owed. */
function takeToolOutcome(state) {
  const text = outcomeLine(state?.conversation?.pendingToolOutcome);
  if (state?.conversation && typeof state.conversation === 'object') {
    state.conversation.pendingToolOutcome = '';
  }
  return text;
}

module.exports = { queueToolOutcome, takeToolOutcome };
