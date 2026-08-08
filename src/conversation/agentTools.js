// Normalize per-tenant receptionist tool toggles.

const DEFAULT_AGENT_TOOLS = Object.freeze({
  escalate: true,
  end_call: true,
});

/**
 * @param {unknown} raw
 * @returns {{ escalate: boolean, end_call: boolean }}
 */
function parseAgentTools(raw) {
  const base = { escalate: true, end_call: true };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  if (typeof raw.escalate === 'boolean') base.escalate = raw.escalate;
  if (typeof raw.end_call === 'boolean') base.end_call = raw.end_call;
  if (typeof raw.endCall === 'boolean') base.end_call = raw.endCall;
  return base;
}

module.exports = {
  DEFAULT_AGENT_TOOLS,
  parseAgentTools,
};
