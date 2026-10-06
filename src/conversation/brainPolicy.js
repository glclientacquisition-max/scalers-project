// Deterministic authority and capability policy for Brain decisions.

const { holdOrdersEnabled, confirmedSlotEnabled, factServices } = require('./provenance');

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
    // Holds/orders need an owner-confirmed catalogue and hold rules. Enquiry stays on.
    placeHold: holdOrdersEnabled(profile),
    // Seed-only services cannot confirm a visit. Unmarked owner services still can.
    confirmVisit: factServices(profile.servicesCatalog).length > 0,
    confirmedSlot: confirmedSlotEnabled(profile),
    createAppointment: runtime.createAppointment !== false,
    updateAppointment: runtime.updateAppointment !== false,
    notifyCallback: runtime.notifyCallback !== false,
    escalate: tools.escalate !== false,
    endCall: tools.end_call !== false && tools.endCall !== false,
    // Voice sets this from liveTransferReady (env + handoff_mode + hours + directory phone).
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
    '- Never invent prices, stock, availability, hours, policies, people, bookings, quantities, delivery times, or guarantees.',
    '- Then, Okay, and Sawa are not a quantity, a time, or consent to save. Ask or admit unknown.',
    '- Speak saved, booked, held, or serving them only from the backend tool result.',
    '- Resolve directly when the answer is known. Do not collect a name or create a callback for a fully answered question.',
    `- Create request: ${capabilities.createServiceRequest ? 'allowed' : 'not available'}.`,
    '- Enquiry and take-a-message always work, even when the file is incomplete.',
    `- Holds and orders: ${capabilities.placeHold ? 'allowed for a confirmed catalogue item when hold rules allow' : 'not available. Take a message. Do not say held or reserved.'}.`,
    `- Confirmed booking slots: ${capabilities.confirmedSlot ? 'allowed' : 'not available. A visit is a request until the owner confirms slots.'}.`,
    `- Create appointment: ${capabilities.createAppointment ? 'allowed' : 'not available'}.`,
    `- Update appointment: ${capabilities.updateAppointment ? 'allowed' : 'not available'}.`,
    `- Callback notification: ${capabilities.notifyCallback ? 'available after a saved request' : 'not available'}.`,
    `- Escalation alert: ${capabilities.escalate ? 'allowed when justified or explicitly requested' : 'not available'}.`,
    `- Live transfer: ${capabilities.liveTransfer ? 'available' : 'NOT AVAILABLE — never claim you are transferring the call'}.`,
    '- A tool marker requests an action; it does not mean the action succeeded.',
    '- When requesting create_service_request, create_appointment, update_appointment, or escalation, speak nothing, or only Okay / Sawa. Never "let me check", "one moment", or "let me save that."',
    '- NEVER say an action is done, saved, held, booked, sent, notified, transferred, or confirmed in the same response as its tool marker. The backend will provide the success or failure confirmation.',
  ].join('\n');
}

module.exports = {
  ACTIONS,
  buildBrainCapabilities,
  authorizeAction,
  formatAuthorityPolicy,
};
