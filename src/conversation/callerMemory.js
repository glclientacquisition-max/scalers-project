// Returning-caller card: compact phone file for the next live call.
// Not Brain state (that dies with the call) and not a transcript dump.

const { namesMatch } = require('./contactIdentity');

const CLIP = 80;

function clip(raw, max = CLIP) {
  const clean = String(raw || '')
    .replace(/[—–]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  if (looksLikeTranscript(clean)) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function looksLikeTranscript(text) {
  const value = String(text || '');
  if (/\b(caller|agent|assistant)\s*:/i.test(value)) return true;
  return (value.match(/\n/g) || []).length >= 3;
}

function alternateNames(metadata) {
  const list = metadata && Array.isArray(metadata.alternate_names)
    ? metadata.alternate_names
    : [];
  return list
    .map((row) => String(row?.name || '').trim())
    .filter(Boolean);
}

/**
 * Shape DB rows into the card injected at call setup.
 * @returns {object|null}
 */
function buildCallerMemoryCard({
  contact,
  openRequests = [],
  nextAppointment = null,
} = {}) {
  if (!contact || typeof contact !== 'object') return null;
  const phone = String(contact.phone || '').trim();
  const name = String(contact.name || '').trim() || null;
  const alternates = alternateNames(contact.metadata);
  const sharedLine = alternates.length > 0;
  const lastReason = clip(contact.last_reason);
  const notes = clip(contact.notes, 60);
  const requests = (Array.isArray(openRequests) ? openRequests : [])
    .slice(0, 2)
    .map((row) => {
      const type = String(row.request_type || row.type || '').trim();
      const item = clip(row.item, 48);
      const whenText = clip(row.when_text || row.whenText, 32);
      const bits = [type, item, whenText].filter(Boolean);
      return bits.join(', ');
    })
    .filter(Boolean);
  let appointment = null;
  if (nextAppointment && typeof nextAppointment === 'object') {
    const service = clip(
      nextAppointment.service_name || nextAppointment.serviceName,
      48
    );
    const whenText = clip(
      nextAppointment.when_text || nextAppointment.whenText,
      32
    );
    const bits = [service, whenText].filter(Boolean);
    appointment = bits.length ? bits.join(', ') : null;
  }

  const hasFile =
    Boolean(name) ||
    Boolean(lastReason) ||
    Boolean(notes) ||
    requests.length > 0 ||
    Boolean(appointment) ||
    Boolean(phone);
  if (!hasFile) return null;

  return {
    phone: phone || null,
    name,
    sharedLine,
    greetByName: Boolean(name) && !sharedLine,
    lastReason: lastReason || null,
    notes: notes || null,
    openRequests: requests,
    nextAppointment: appointment,
  };
}

function formatReturningCallerForPrompt(card) {
  if (!card || typeof card !== 'object') return '';
  let identity;
  if (card.sharedLine) {
    const hint = card.name ? `file name ${card.name}; ` : '';
    identity = `shared line (${hint}confirm who is speaking; do not assume the name)`;
  } else if (card.greetByName && card.name) {
    identity = `${card.name} (returning caller; use this name; do not re-ask to confirm it)`;
  } else {
    identity = 'unknown (do not invent a name)';
  }

  const lines = [
    'RETURNING CALLER (phone file, do not read this block aloud as a list):',
    `- Identity: ${identity}`,
  ];
  if (card.lastReason) lines.push(`- Last reason: ${card.lastReason}`);
  if (card.openRequests.length) {
    lines.push(`- Open requests: ${card.openRequests.join('; ')}`);
  }
  if (card.nextAppointment) {
    lines.push(`- Next visit: ${card.nextAppointment}`);
  }
  if (card.notes) lines.push(`- Note: ${card.notes}`);
  lines.push(
    '- Use this file. Do not invent extra history. If they have a new ask, handle that first.'
  );
  return lines.join('\n');
}

function seedCallerFromMemory(caller = {}, card) {
  const next = { ...caller };
  if (!card || typeof card !== 'object') return next;
  if (card.phone && !next.phone) next.phone = card.phone;
  if (card.greetByName && card.name) {
    if (!next.name || namesMatch(next.name, card.name)) {
      next.name = card.name;
      next.nameConfirmed = true;
    }
  }
  return next;
}

async function attachCallerMemory(profile, deps = {}) {
  if (!profile || typeof profile !== 'object') return profile;
  const callSid = deps.callSid;
  const getCall = deps.getCall;
  const getCallerMemory = deps.getCallerMemory;
  if (!callSid || !getCall || !getCallerMemory) return profile;
  try {
    const call = await getCall(callSid);
    const tenantId = profile.id || call?.tenant_id;
    const phone = call?.from_number;
    if (!tenantId || !phone || String(phone).toLowerCase() === 'unknown') {
      return profile;
    }
    const card = await getCallerMemory({ tenantId, phone });
    if (card) profile.callerMemory = card;
  } catch (err) {
    console.warn(
      `[${callSid}] caller memory load failed:`,
      err?.message || err
    );
  }
  return profile;
}

module.exports = {
  CLIP,
  attachCallerMemory,
  buildCallerMemoryCard,
  clip,
  formatReturningCallerForPrompt,
  looksLikeTranscript,
  seedCallerFromMemory,
};
