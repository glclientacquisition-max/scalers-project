// Deterministic authority and capability policy for Brain decisions.

const ACTIONS = Object.freeze({
  ANSWER: 'ANSWER',
  ASK_CLARIFICATION: 'ASK_CLARIFICATION',
  CONFIRM: 'CONFIRM',
  CREATE_REQUEST: 'CREATE_REQUEST',
  CAPTURE: 'CAPTURE',
  ESCALATE: 'ESCALATE',
  TRANSFER: 'TRANSFER',
  REPAIR: 'APOLOGIZE_AND_REPAIR',
  END: 'END',
});

function buildBrainCapabilities(profile = {}, runtime = {}) {
  const tools = profile.agentTools || {};
  return {
    answerFromKnowledge: true,
    saveCallerInfo: true,
    createServiceRequest: runtime.createServiceRequest !== false,
    createAppointment: runtime.createAppointment !== false,
    updateAppointment: runtime.updateAppointment !== false,
    notifyCallback: runtime.notifyCallback !== false,
    escalate: tools.escalate !== false,
    endCall: tools.end_call !== false && tools.endCall !== false,
    // There is no live transfer executor in the current voice runtime.
    liveTransfer: runtime.liveTransfer === true,
  };
}

function authorizeAction(action, capabilities = {}) {
  const requiredCapability = {
    CREATE_REQUEST: 'createServiceRequest',
    CAPTURE: 'saveCallerInfo',
    ESCALATE: 'escalate',
    TRANSFER: 'liveTransfer',
    END: 'endCall',
  }[action];
  if (!requiredCapability) return { allowed: true, reason: 'No capability required.' };
  if (capabilities[requiredCapability] === true) {
    return { allowed: true, reason: `${requiredCapability} is available.` };
  }
  return {
    allowed: false,
    reason: `${requiredCapability} is not available for this call.`,
  };
}

function formatAuthorityPolicy(capabilities = {}) {
  return [
    'AUTHORITY / ACTION POLICY (hard constraints; do not read aloud):',
    '- Answer only from LIVE GROUND TRUTH and verified business knowledge.',
    '- Never invent prices, stock, availability, hours, policies, people, bookings, delivery times, or guarantees.',
    '- Resolve directly when the answer is known. Do not collect a name or create a callback for a fully answered question.',
    `- Create request: ${capabilities.createServiceRequest ? 'allowed' : 'not available'}.`,
    `- Create appointment: ${capabilities.createAppointment ? 'allowed' : 'not available'}.`,
    `- Update appointment: ${capabilities.updateAppointment ? 'allowed' : 'not available'}.`,
    `- Callback notification: ${capabilities.notifyCallback ? 'available after a saved request' : 'not available'}.`,
    `- Escalation alert: ${capabilities.escalate ? 'allowed when justified or explicitly requested' : 'not available'}.`,
    `- Live transfer: ${capabilities.liveTransfer ? 'available' : 'NOT AVAILABLE — never claim you are transferring the call'}.`,
    '- A tool marker requests an action; it does not mean the action succeeded.',
    '- When requesting create_service_request, create_appointment, update_appointment, or escalation, speak only an attempt statement such as "Let me save that."',
    '- NEVER say an action is done, saved, held, booked, sent, notified, transferred, or confirmed in the same response as its tool marker. The backend will provide the success or failure confirmation.',
  ].join('\n');
}

module.exports = {
  ACTIONS,
  buildBrainCapabilities,
  authorizeAction,
  formatAuthorityPolicy,
};
