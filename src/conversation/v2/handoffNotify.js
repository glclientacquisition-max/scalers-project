'use strict';
// Owner notify for BRAIN_ENGINES handoff (SMS → WhatsApp → email via dispatch).
const { findNotifyCatchAll } = require('../teamPermissions');
const { buildEscalationText, teammateLabel } = require('../escalation');
const { dispatchEscalationAlert } = require('../../notifications/dispatch');

function resolveCallbackTeammate(profile = {}) {
  const team = profile.teamDirectory || [];
  const catchAll = findNotifyCatchAll(team);
  if (catchAll) return catchAll;
  const ownerPhone = profile.ownerPhone || profile.owner_phone || null;
  if (ownerPhone) return { name: profile.ownerName || 'Owner', role: 'owner', phone: ownerPhone, email: profile.ownerEmail || null };
  return null;
}

/**
 * Idempotent per call: machine.handoff.notifySent.
 * @param {Function} [dispatch] inject for tests (default dispatchEscalationAlert).
 */
async function notifyHandoffOwner({ machine, profile, reason, name, phone, dispatch = dispatchEscalationAlert } = {}) {
  const h = machine.handoff || {};
  if (h.notifySent) return { ok: true, duplicate: true, channel: h.notifyChannel || null };
  const teammate = resolveCallbackTeammate(profile);
  const businessName = profile.businessName || profile.name || '';
  const lead = {
    businessName,
    name: name || 'Caller',
    reason: reason || 'callback',
    callerNumber: phone || machine.callerPhone,
  };
  const body = buildEscalationText({
    ...lead,
    callerName: lead.name,
    teammate,
    requested: 'callback',
    match: 'fallback',
  });
  const sent = await dispatch({
    teammatePhone: teammate?.phone || null,
    teammateEmail: teammate?.email || null,
    ownerPhone: profile.ownerPhone || profile.owner_phone || null,
    ownerEmail: profile.ownerEmail || profile.owner_email || null,
    body,
    lead,
    channels: profile.notifyChannels,
    subject: `Callback for ${teammateLabel(teammate)}${businessName ? `. ${businessName}` : ''}`,
    ledger: {
      tenantId: profile.id || null,
      callId: machine.callId || null,
      callSid: machine.callId || null,
      kind: 'escalation',
    },
  });
  const channel = Array.isArray(sent) && sent[0]?.channel ? sent[0].channel : sent?.channel || null;
  h.notifySent = true;
  h.notifyChannel = channel;
  return { ok: !!channel, channel, duplicate: false };
}

function createHandoffNotifier(profile, { dispatch, machine } = {}) {
  return (args) => notifyHandoffOwner({ profile, machine, dispatch, ...args });
}

module.exports = { notifyHandoffOwner, createHandoffNotifier, resolveCallbackTeammate };
