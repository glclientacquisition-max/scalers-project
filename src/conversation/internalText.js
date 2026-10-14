'use strict';

// BRAIN_TRUST_P1: Brain/NBA instructions to the model ("Append
// create_appointment and speak nothing", "Do not tell the caller…") must
// never reach the owner email, Desk summary or resolution note.

const INTERNAL = /\b(?:append\s+\w*_\w+|speak nothing|backend speaks|the backend|do not tell the caller|tell the caller|slots? (?:are|is) complete|ask only for|first missing slot|call state|next[- ]best[- ]action|nba\b|permitted end-call action|ask for that one slot|attempt direct resolution|close naturally|resolve from knowledge|the goal needs|the caller goal is complete|do not (?:say|read|ask|narrate)|never (?:say|claim|read)|(?:create|update)_(?:appointment|service_request)|save_caller_info|escalate\s*\{|###tool###)/i;

function trustOn() {
  return String(process.env.BRAIN_TRUST_P1 || '').trim() === 'on';
}

function isInternalInstruction(text) {
  return INTERNAL.test(String(text || ''));
}

/** Drop sentences that are model instructions; '' when nothing is left. */
function stripInternal(text) {
  const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!raw || !trustOn()) return raw;
  const parts = raw.split(/(?<=[.!?])\s+/).filter((s) => !isInternalInstruction(s));
  return parts.join(' ').trim();
}

module.exports = { INTERNAL, isInternalInstruction, stripInternal };
