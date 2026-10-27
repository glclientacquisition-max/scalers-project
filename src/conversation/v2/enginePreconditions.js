'use strict';
// BRAIN_ENGINES slot preconditions: ONE table of what every write needs before it may be attempted.
// The call plan asks for the first missing slot (it becomes the next goal); the commit gate re-checks the
// same table and refuses to write with a missing slot. Name plausibility uses the executor's own rules
// (toolExecution / messageOnly), so a name that passes here is never rejected later as "needs the caller name".
const CP = require('./callPlan');

const REQUIRED = Object.freeze({
  create_booking: ['service', 'date', 'time', 'place', 'name'],
  create_handoff: ['name', 'phone'],
  owner_request: ['name', 'phone'],
});

function plausibleName(name, profile = {}) {
  const n = String(name || '').trim();
  if (!n || n.length < 2 || n.length > 60) return false;
  if (/\d/.test(n)) return false;
  try {
    const { isReservedCallerName } = require('../toolExecution');
    if (isReservedCallerName(n, { agentName: profile.agentName || '', businessName: profile.businessName || '' })) return false;
  } catch { /* optional */ }
  try {
    const { messageNamePlausible } = require('../messageOnly');
    if (typeof messageNamePlausible === 'function' && !messageNamePlausible(n)) return false;
  } catch { /* optional */ }
  return true;
}

/** The name the plan may use: locked (confirmed) or the candidate this call heard. */
function callerName(machine) {
  return CP.lockedName(machine) || (machine.slots && (machine.slots.name || machine.slots.nameCandidate)) || null;
}

function slotValue(slot, machine, { callerPhone } = {}) {
  const s = machine.slots || {};
  switch (slot) {
    case 'service': return s.service || null;
    case 'date': return (s.when && s.when.date) || null;
    case 'time': return (s.when && s.when.time) || null;
    case 'place': return s.place || null;
    case 'name': return callerName(machine);
    case 'phone': return callerPhone || machine.callerPhone || null;
    default: return null;
  }
}

/** -> [] when every required slot is present, else the missing slots in ask order. */
function missingSlots(tool, machine, { profile = {}, callerPhone } = {}) {
  const need = REQUIRED[tool] || [];
  const out = [];
  for (const slot of need) {
    const v = slotValue(slot, machine, { callerPhone });
    if (!v) { out.push(slot); continue; }
    if (slot === 'name' && !plausibleName(v, profile)) out.push(slot);
  }
  return out;
}

module.exports = { REQUIRED, missingSlots, slotValue, callerName, plausibleName };
