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
  let nextVisitService = null;
  let nextVisitWhen = null;
  if (nextAppointment && typeof nextAppointment === 'object') {
    const service = clip(
      nextAppointment.service_name || nextAppointment.serviceName,
      48
    );
    const whenText = clip(
      nextAppointment.when_text || nextAppointment.whenText,
      32
    );
    nextVisitService = service || null;
    nextVisitWhen = whenText || null;
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
    alternateNames: alternates,
    lastReason: lastReason || null,
    notes: notes || null,
    openRequests: requests,
    nextAppointment: appointment,
    nextVisitService,
    nextVisitWhen,
  };
}

function returningFileFromCard(card) {
  if (!card || typeof card !== 'object') return null;
  return {
    sharedLine: Boolean(card.sharedLine),
    greetByName: Boolean(card.greetByName),
    name: card.name || null,
    lastReason: card.lastReason || null,
    nextVisit: card.nextAppointment || null,
    nextVisitService: card.nextVisitService || null,
    nextVisitWhen: card.nextVisitWhen || null,
    openRequests: Array.isArray(card.openRequests) ? card.openRequests : [],
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
    '- First reasoned turn must use this file. Do not start a first-meeting name SOP.'
  );
  if (card.sharedLine) {
    lines.push(
      '- Shared line: ask who is speaking before using the file name or attaching a visit.'
    );
  } else if (card.nextAppointment) {
    lines.push(
      '- Open visit on file. If they want it moved or cancelled, update that visit. Do not create_appointment unless they ask for a new job. Do not re-ask the name.'
    );
  } else if (card.lastReason) {
    lines.push(
      '- Last reason is the default job unless they name a new one. Do not re-ask the name.'
    );
  }
  lines.push(
    '- If they have a new ask, handle that first. Do not invent extra history.'
  );
  return lines.join('\n');
}

function formatReturningFileForCallState(returning) {
  if (!returning || typeof returning !== 'object') return '';
  if (returning.sharedLine) {
    return '- Returning file: shared line. Ask who is speaking. Do not use the file name. Do not attach a visit yet.';
  }
  const bits = [];
  if (returning.name) bits.push(`unique ${returning.name}`);
  else bits.push('unique line');
  if (returning.nextVisit) bits.push(`open visit ${returning.nextVisit}`);
  else if (returning.lastReason) bits.push(`last reason ${returning.lastReason}`);
  const duty = returning.nextVisit
    ? 'Speak to that visit. Do not create a second visit unless they ask for a new job. Do not re-ask the name.'
    : returning.lastReason
      ? 'Use last reason unless they have a new ask. Do not re-ask the name.'
      : 'Do not re-ask the name.';
  return `- Returning file: ${bits.join('; ')}. ${duty}`;
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
  formatReturningFileForCallState,
  returningFileFromCard,
  looksLikeTranscript,
  seedCallerFromMemory,
};
