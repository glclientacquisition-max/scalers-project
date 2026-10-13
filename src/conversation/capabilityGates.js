// Unified capability gates for the Business Assistant.
//
// One model for every action the assistant can only take once the owner has set
// it up: holds, site visits, booked time slots, callbacks. Each gate lists
// the requirements that are still missing, keyed by stable ids shared with the
// dashboard twin (dashboard/src/lib/capabilityGates.ts), so the owner's
// "Needs setup" sheet and the call brain always agree.
//
// Holds: tenant_hold_gate (server RPC) is the source of truth. Its English
// reasons are mapped to requirement ids here. When the RPC is missing on a
// database, holdOrdersEnabled keeps the legacy catalogue + hold-rule fallback.

const { holdOrdersEnabled, confirmedSlotEnabled, factServices } = require('./provenance');

const CAPABILITY_IDS = Object.freeze(['holds', 'site_visits', 'booking_slots', 'callbacks']);

/** Map one tenant_hold_gate reason string to a requirement id. */
function holdReasonId(reason) {
  const text = String(reason || '').toLowerCase();
  if (/not enabled in policies/.test(text)) return 'holds_policy_on';
  if (/holdable product/.test(text)) return 'holdable_item';
  if (/notify target|alerts/.test(text)) return 'verified_alert';
  return null;
}

function holdMissing(profile = {}) {
  const gate = profile.holdGate;
  if (gate && typeof gate === 'object' && Array.isArray(gate.reasons)) {
    const reasons = gate.reasons.map(String);
    if (!reasons.includes('provenance_rpc_missing')) {
      return [...new Set(reasons.map(holdReasonId).filter(Boolean))];
    }
  }
  return holdOrdersEnabled(profile) ? [] : ['holds_policy_on', 'holdable_item'];
}

/** A teammate who gets alerts and can be reached on WhatsApp (phone) or email. */
function teamHasCallbackContact(raw) {
  if (!Array.isArray(raw)) return false;
  return raw.some((row) => {
    const r = row || {};
    if (r.receives_escalation === false) return false;
    const phone = String(r.phone || '').replace(/[^\d]/g, '');
    const email = String(r.email || '').trim();
    return phone.length >= 9 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  });
}

/**
 * @param {object} profile tenant profile (camelCase, as built by tenantProfile.js)
 * @returns {Record<string, { allowed: boolean, missing: string[] }>}
 */
function evaluateCapabilityGates(profile = {}) {
  const fieldMeta = profile.fieldMeta || null;
  const holdsAllowed = holdOrdersEnabled(profile);
  const holds = {
    allowed: holdsAllowed,
    missing: holdsAllowed ? [] : holdMissing(profile),
  };
  if (!holds.allowed && !holds.missing.length) holds.missing = ['holds_policy_on'];

  const ownerServices = factServices(profile.servicesCatalog, fieldMeta).length > 0;
  const siteVisits = { allowed: ownerServices, missing: ownerServices ? [] : ['owner_service'] };

  const slots = confirmedSlotEnabled(profile);
  const bookingSlots = { allowed: slots, missing: slots ? [] : ['booking_mode_confirmed'] };

  // Callbacks only (no live transfer): a teammate who gets alerts on WhatsApp or
  // email, and the escalate tool on. Same ids as the dashboard twin.
  const callbackMissing = [];
  if (!teamHasCallbackContact(profile.teamDirectory)) callbackMissing.push('callback_contact');
  const tools = profile.agentTools;
  if (tools && typeof tools === 'object' && tools.escalate === false) callbackMissing.push('escalate_on');
  const callbacks = { allowed: callbackMissing.length === 0, missing: callbackMissing };

  return {
    holds,
    site_visits: siteVisits,
    booking_slots: bookingSlots,
    callbacks,
  };
}

module.exports = {
  CAPABILITY_IDS,
  holdReasonId,
  teamHasCallbackContact,
  evaluateCapabilityGates,
};
