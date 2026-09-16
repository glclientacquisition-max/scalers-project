// Returning-caller card: compact phone file for the next live call.
// Not Brain state (that dies with the call) and not a transcript dump.

const { namesMatch } = require('./contactIdentity');
const { isJunkCallerName } = require('./callerNameQuality');

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
    fileOwnerName: name,
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

function cardAlternateNames(card) {
  return (card?.alternateNames || [])
    .map((row) => (typeof row === 'string' ? row : String(row?.name || '')).trim())
    .filter(Boolean);
}

function snapshotHouseholdFile(card) {
  if (card?.householdFile && typeof card.householdFile === 'object') {
    return card.householdFile;
  }
  return {
    lastReason: card?.lastReason || null,
    notes: card?.notes || null,
    openRequests: Array.isArray(card?.openRequests) ? card.openRequests : [],
    nextAppointment: card?.nextAppointment || null,
    nextVisitService: card?.nextVisitService || null,
    nextVisitWhen: card?.nextVisitWhen || null,
  };
}

function fileOwnerNameOf(card) {
  if (!card || typeof card !== 'object') return null;
  if (card.fileOwnerName) return String(card.fileOwnerName).trim() || null;
  if (card.fileRole === 'alternate' || card.fileRole === 'other') return null;
  return String(card.name || '').trim() || null;
}

/**
 * Who on this phone file the spoken name matches.
 * Primary owns last reason / open visit. Alternate or other does not.
 */
function matchCardPerson(card, spokenName) {
  const spoken = String(spokenName || '').trim();
  if (!card || !spoken) return { role: 'none', name: null };
  const owner = fileOwnerNameOf(card);
  if (owner && namesMatch(spoken, owner)) {
    return { role: 'primary', name: owner };
  }
  for (const alt of cardAlternateNames(card)) {
    if (namesMatch(spoken, alt)) return { role: 'alternate', name: alt };
  }
  const shared = Boolean(card.sharedLine) || cardAlternateNames(card).length > 0;
  if (!shared && !owner) {
    return { role: 'primary', name: spoken };
  }
  return { role: 'other', name: spoken };
}

function returningFileUsable(file) {
  if (!file || typeof file !== 'object') return false;
  if (file.fileRole === 'primary') return true;
  if (file.fileRole === 'alternate' || file.fileRole === 'other') return false;
  return !file.sharedLine;
}

function speakerKnownOnFile(file) {
  if (!file || typeof file !== 'object') return false;
  if (file.identityBound) return true;
  return Boolean(file.greetByName && !file.sharedLine);
}

function liveCallerFileStamp(card) {
  if (!card || typeof card !== 'object') return '';
  return `${card.fileRole || ''}:${card.boundName || ''}:${card.identityBound ? '1' : '0'}`;
}

/**
 * After a confirmed spoken name, bind this phone card to that speaker.
 * Shared line: primary keeps the household visit; anyone else does not.
 * Unique line: a different name does not inherit the file owner's visit.
 */
function bindCallerMemoryCard(card, spokenName) {
  if (!card || typeof card !== 'object') return card || null;
  const spoken = String(spokenName || '').trim();
  if (!spoken || isJunkCallerName(spoken)) return card;

  const fileOwnerName = fileOwnerNameOf(card) || card.name || null;
  const householdFile = snapshotHouseholdFile(card);
  const match = matchCardPerson({ ...card, fileOwnerName }, spoken);
  const boundName = match.name || spoken;
  const fileRole = match.role === 'none' ? 'other' : match.role;

  if (
    card.identityBound &&
    card.fileRole === fileRole &&
    namesMatch(card.boundName, boundName)
  ) {
    return card;
  }

  const base = {
    ...card,
    fileOwnerName,
    householdFile,
    identityBound: true,
    boundName,
    fileRole,
  };

  if (fileRole === 'primary') {
    return {
      ...base,
      name: fileOwnerName || boundName,
      greetByName: true,
      lastReason: householdFile.lastReason,
      notes: householdFile.notes,
      openRequests: householdFile.openRequests,
      nextAppointment: householdFile.nextAppointment,
      nextVisitService: householdFile.nextVisitService,
      nextVisitWhen: householdFile.nextVisitWhen,
    };
  }

  return {
    ...base,
    name: boundName,
    greetByName: true,
    lastReason: null,
    notes: null,
    openRequests: [],
    nextAppointment: null,
    nextVisitService: null,
    nextVisitWhen: null,
  };
}

function applyLiveCallerFile(profile, state) {
  if (!state || typeof state !== 'object') return { changed: false };
  const spoken = state.caller?.nameConfirmed
    ? String(state.caller.name || '').trim()
    : '';
  if (!spoken) return { changed: false };
  const current = profile?.callerMemory || null;
  if (!current) return { changed: false };
  const before = liveCallerFileStamp(current);
  const next = bindCallerMemoryCard(current, spoken);
  if (profile && next) profile.callerMemory = next;
  state.returning = returningFileFromCard(next);
  return { changed: liveCallerFileStamp(next) !== before };
}

function returningFileFromCard(card) {
  if (!card || typeof card !== 'object') return null;
  const fileRole =
    card.fileRole ||
    (card.greetByName && !card.sharedLine ? 'primary' : null);
  const usable = returningFileUsable({ ...card, fileRole });
  return {
    sharedLine: Boolean(card.sharedLine),
    greetByName: Boolean(card.greetByName),
    name: card.name || null,
    lastReason: usable ? card.lastReason || null : null,
    nextVisit: usable ? card.nextAppointment || null : null,
    nextVisitService: usable ? card.nextVisitService || null : null,
    nextVisitWhen: usable ? card.nextVisitWhen || null : null,
    openRequests: usable && Array.isArray(card.openRequests) ? card.openRequests : [],
    identityBound: Boolean(card.identityBound) || Boolean(fileRole === 'primary' && !card.sharedLine),
    boundName: card.boundName || (usable ? card.name : null) || null,
    fileRole,
    fileOwnerName: fileOwnerNameOf(card),
  };
}

function formatReturningCallerForPrompt(card) {
  if (!card || typeof card !== 'object') return '';
  const usable = returningFileUsable(card);
  const known = speakerKnownOnFile(card);
  let identity;
  if (known && usable && card.name) {
    identity = `${card.name} (returning caller; use this name; do not re-ask to confirm it)`;
  } else if (known && !usable) {
    const who = card.boundName || card.name || 'this speaker';
    identity = `${who} (this speaker on a shared line; not the household file; do not invent their history)`;
  } else if (card.sharedLine) {
    const hint = card.fileOwnerName || card.name
      ? `file name ${card.fileOwnerName || card.name}; `
      : '';
    identity = `shared line (${hint}confirm who is speaking; do not assume the name)`;
  } else if (card.greetByName && card.name) {
    identity = `${card.name} (returning caller; use this name; do not re-ask to confirm it)`;
  } else {
    identity = 'unknown (do not invent a name)';
  }

  const lastReason = usable ? card.lastReason : null;
  const openRequests = usable && Array.isArray(card.openRequests) ? card.openRequests : [];
  const nextAppointment = usable ? card.nextAppointment : null;
  const notes = usable ? card.notes : null;

  const lines = [
    'RETURNING CALLER (phone file, do not read this block aloud as a list):',
    `- Identity: ${identity}`,
  ];
  if (lastReason) lines.push(`- Last reason: ${lastReason}`);
  if (openRequests.length) {
    lines.push(`- Open requests: ${openRequests.join('; ')}`);
  }
  if (nextAppointment) {
    lines.push(`- Next visit: ${nextAppointment}`);
  }
  if (notes) lines.push(`- Note: ${notes}`);
  lines.push(
    '- First reasoned turn must use this file. Do not start a first-meeting name SOP.'
  );
  if (card.sharedLine && !known) {
    lines.push(
      '- Shared line: ask who is speaking before using the file name or attaching a visit.'
    );
  } else if (known && !usable) {
    lines.push(
      '- This speaker is not the household file owner. Do not attach that visit or last reason.'
    );
  } else if (nextAppointment) {
    lines.push(
      '- Open visit on file. If they want it moved or cancelled, update that visit. Do not create_appointment unless they ask for a new job. Do not re-ask the name.'
    );
  } else if (lastReason) {
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
  if (returning.sharedLine && !speakerKnownOnFile(returning)) {
    return '- Returning file: shared line. Ask who is speaking. Do not use the file name. Do not attach a visit yet.';
  }
  if (!returningFileUsable(returning)) {
    const who = returning.boundName || returning.name || 'this speaker';
    return `- Returning file: ${who} on a shared line. Not the household file. Do not attach that visit or last reason. Do not re-ask the name.`;
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
  applyLiveCallerFile,
  attachCallerMemory,
  bindCallerMemoryCard,
  buildCallerMemoryCard,
  clip,
  formatReturningCallerForPrompt,
  formatReturningFileForCallState,
  liveCallerFileStamp,
  looksLikeTranscript,
  matchCardPerson,
  returningFileFromCard,
  returningFileUsable,
  seedCallerFromMemory,
  speakerKnownOnFile,
};
