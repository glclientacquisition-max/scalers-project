// Returning-caller card: compact phone file for the next live call.
// Not Brain state (that dies with the call) and not a transcript dump.
// Visit lines are refreshed against now (EAT). A stored "tomorrow" is not
// repeated once that window or date has passed.

const { namesMatch } = require('./contactIdentity');
const { isJunkCallerName } = require('./callerNameQuality');
const { compactNameKey } = require('./callerNameMatch');
const { classifyLivedVisit } = require('./visitCalendar');

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
  recentAppointments = [],
  now = new Date(),
} = {}) {
  if (!contact || typeof contact !== 'object') return null;
  const phone = String(contact.phone || '').trim();
  const name = String(contact.name || '').trim() || null;
  const alternates = alternateNames(contact.metadata);
  const sharedLine = alternates.length > 0;
  const lived = collectLivedAppointments(nextAppointment, recentAppointments, now);
  const nextItem = lived.open[0] || null;
  const nextRow = nextItem ? nextItem.row : null;
  const lastReason = clip(scrubLivedReason(contact.last_reason, lived));
  const notes = clip(contact.notes, 60);
  const requests = freshOpenRequestRows(openRequests, now)
    .slice(0, 2)
    .map(clipRequestLine)
    .filter(Boolean);
  const openVisitLines = lived.open
    .map((item) => clipVisitLine(item.row))
    .filter(Boolean);
  const appointment = openVisitLines[0] || null;
  const nextVisitService = nextRow
    ? clip(nextRow.service_name || nextRow.serviceName, 48) || null
    : null;
  const nextVisitWhen = nextRow
    ? clip(nextRow.when_text || nextRow.whenText, 32) || null
    : null;
  const nextVisitStatus = nextRow ? clip(nextRow.status, 16) || null : null;
  const nextVisitLandmark = nextRow
    ? clip(
        nextRow.address_landmark || nextRow.addressLandmark || nextRow.landmark,
        48
      ) || null
    : null;
  const extraOpenRows = lived.open.slice(1).map((item) => item.row);
  const recentRows = selectRecentAppointmentRows(lived.history, null);
  const recentBookings = recentRows.map((row) => clipVisitLine(row)).filter(Boolean);
  const profile = clipCallerProfile(contact.metadata);
  const place = profile.landmark || nextVisitLandmark || derivePlace(recentRows);
  const usualJob = profile.typicalJob || deriveUsualJob([...recentRows, ...extraOpenRows], nextRow);
  const standing = profile.standing;
  const language = profile.language;
  const personProfiles = clipPersonProfiles(contact.metadata);

  const hasFile =
    Boolean(name) ||
    Boolean(lastReason) ||
    Boolean(notes) ||
    requests.length > 0 ||
    Boolean(appointment) ||
    recentBookings.length > 0 ||
    Boolean(place) ||
    Boolean(usualJob) ||
    Boolean(standing) ||
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
    openVisits: openVisitLines,
    nextAppointment: appointment,
    nextVisitService,
    nextVisitWhen,
    nextVisitStatus,
    nextVisitLandmark,
    recentBookings,
    place: place || null,
    usualJob: usualJob || null,
    standing: standing || null,
    language: language || null,
    personProfiles,
  };
}

function clipLang(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'en' || value === 'sw' || value === 'sheng') return value;
  return null;
}

function joinWorkBits(parts) {
  return parts.filter(Boolean).join(' | ');
}

function clipVisitLine(row) {
  if (!row || typeof row !== 'object') return null;
  const service = clip(row.service_name || row.serviceName, 48);
  const whenText = clip(row.when_text || row.whenText, 32);
  const status = clip(row.status, 16);
  const landmark = clip(
    row.address_landmark || row.addressLandmark || row.landmark,
    48
  );
  const line = joinWorkBits([service, whenText, status, landmark]);
  return line || null;
}

function clipRequestLine(row) {
  if (!row || typeof row !== 'object') return null;
  const type = clip(row.request_type || row.type, 16) || 'request';
  const item = clip(row.item, 48);
  const whenText = clip(row.when_text || row.whenText, 32);
  const line = joinWorkBits([type, item, whenText]);
  return line || null;
}

function clipCallerProfile(metadata) {
  const raw = metadata && typeof metadata === 'object' ? metadata.caller_profile : null;
  if (!raw || typeof raw !== 'object') {
    return { standing: null, language: null, typicalJob: null, landmark: null };
  }
  return {
    standing: clip(raw.standing, 80) || null,
    language: clipLang(raw.language),
    typicalJob: clip(raw.typical_job, 48) || null,
    landmark: clip(raw.landmark, 48) || null,
  };
}

function clipPersonProfiles(metadata) {
  const raw = metadata && typeof metadata === 'object' ? metadata.caller_profile : null;
  const persons = raw && typeof raw === 'object' ? raw.persons : null;
  if (!persons || typeof persons !== 'object') return {};
  const out = {};
  for (const [key, row] of Object.entries(persons)) {
    if (!row || typeof row !== 'object') continue;
    const compact = compactNameKey(key);
    if (!compact) continue;
    out[compact] = {
      standing: clip(row.standing, 80) || null,
      language: clipLang(row.language),
      typical_job: clip(row.typical_job, 48) || null,
      landmark: clip(row.landmark, 48) || null,
    };
  }
  return out;
}

function refreshLivedRow(row, lived) {
  const whenText = lived.whenLabel || row.when_text || row.whenText || '';
  return { ...row, when_text: whenText, whenText };
}

function collectLivedAppointments(nextAppointment, recentAppointments, now) {
  const seen = new Set();
  const source = [];
  const rows = [
    nextAppointment,
    ...(Array.isArray(recentAppointments) ? recentAppointments : []),
  ];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim();
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    source.push(row);
  }
  const open = [];
  const history = [];
  const judged = [];
  for (const row of source) {
    const lived = classifyLivedVisit(row, now);
    const refreshed = refreshLivedRow(row, lived);
    const status = String(row.status || '').toLowerCase();
    const openStatus = !status || status === 'requested' || status === 'confirmed';
    const isOpen = openStatus && !lived.past;
    judged.push({ lived, open: isOpen });
    if (isOpen) open.push({ row: refreshed, lived });
    else history.push(refreshed);
  }
  open.sort((a, b) => {
    const ta = a.lived.instant ? a.lived.instant.getTime() : Number.POSITIVE_INFINITY;
    const tb = b.lived.instant ? b.lived.instant.getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  return { open, history, judged };
}

function scrubLivedReason(text, lived) {
  const raw = String(text || '');
  if (!/\b(?:today|tomorrow|tonight|leo|kesho)\b/i.test(raw)) return raw;
  const judged = Array.isArray(lived?.judged) ? lived.judged : [];
  const open = Array.isArray(lived?.open) ? lived.open : [];
  const pastRelative = judged.some((item) => item.lived.past && item.lived.relative);
  const openRelative = open.some((item) => item.lived.relative);
  if (pastRelative && !openRelative) {
    return raw
      .replace(/\b(?:today|tomorrow|tonight|leo|kesho)\b/gi, 'past')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const lead = open.find((item) => item.lived.relative && item.lived.spokenDay);
  if (!lead) return raw;
  const word = lead.lived.spokenDay;
  if (word === 'today') {
    return raw.replace(/\b(?:tomorrow|kesho)\b/gi, 'today').replace(/\s+/g, ' ').trim();
  }
  if (word === 'tomorrow' || word === 'past') return raw;
  return raw.replace(/\b(?:tomorrow|kesho)\b/gi, word).replace(/\s+/g, ' ').trim();
}

function freshOpenRequestRows(rows, now) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const lived = classifyLivedVisit(row, now);
    if (lived.past) continue;
    out.push(refreshLivedRow(row, lived));
  }
  return out;
}

function selectRecentAppointmentRows(rows = [], nextAppointment = null) {
  const nextId = nextAppointment && nextAppointment.id
    ? String(nextAppointment.id)
    : '';
  const list = (Array.isArray(rows) ? rows : []).filter(
    (row) => row && typeof row === 'object'
  );
  const notNext = list.filter(
    (row) => !nextId || String(row.id || '') !== nextId
  );
  const preferred = notNext.filter((row) => {
    const status = String(row.status || '').toLowerCase();
    return status !== 'cancelled';
  });
  return (preferred.length ? preferred : notNext).slice(0, 2);
}

function derivePlace(rows = []) {
  for (const row of rows) {
    const hit = clip(
      row?.address_landmark || row?.addressLandmark || row?.landmark,
      48
    );
    if (hit) return hit;
  }
  return null;
}

function deriveUsualJob(recentRows = [], nextAppointment = null) {
  const counts = new Map();
  function add(raw) {
    const name = clip(raw, 48);
    if (!name) return;
    const key = name.toLowerCase();
    const prev = counts.get(key) || { name, n: 0 };
    prev.n += 1;
    counts.set(key, prev);
  }
  add(nextAppointment?.service_name || nextAppointment?.serviceName);
  for (const row of recentRows) {
    add(row?.service_name || row?.serviceName);
  }
  let best = null;
  for (const row of counts.values()) {
    if (!best || row.n > best.n) best = row;
  }
  if (!best || best.n < 2) return null;
  return best.name;
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
    openVisits: Array.isArray(card?.openVisits) ? card.openVisits : [],
    nextAppointment: card?.nextAppointment || null,
    nextVisitService: card?.nextVisitService || null,
    nextVisitWhen: card?.nextVisitWhen || null,
    nextVisitStatus: card?.nextVisitStatus || null,
    nextVisitLandmark: card?.nextVisitLandmark || null,
    recentBookings: Array.isArray(card?.recentBookings) ? card.recentBookings : [],
    place: card?.place || null,
    usualJob: card?.usualJob || null,
    standing: card?.standing || null,
    language: card?.language || null,
    personProfiles:
      card?.personProfiles && typeof card.personProfiles === 'object'
        ? card.personProfiles
        : {},
  };
}

function factsForBoundRole(householdFile, fileRole, boundName) {
  if (fileRole === 'primary') {
    return {
      place: householdFile.place || null,
      usualJob: householdFile.usualJob || null,
      standing: householdFile.standing || null,
      language: householdFile.language || null,
    };
  }
  const persons = householdFile.personProfiles || {};
  const person = persons[compactNameKey(boundName)];
  if (!person || typeof person !== 'object') {
    return { place: null, usualJob: null, standing: null, language: null };
  }
  return {
    place: person.landmark || null,
    usualJob: person.typical_job || null,
    standing: person.standing || null,
    language: person.language || null,
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
  return file.fileRole === 'primary' && Boolean(file.identityBound);
}

function speakerKnownOnFile(file) {
  if (!file || typeof file !== 'object') return false;
  return Boolean(file.identityBound);
}

function fileHasHistory(card) {
  if (!card || typeof card !== 'object') return false;
  return Boolean(
      card.lastReason ||
      card.nextAppointment ||
      card.nextVisit ||
      card.place ||
      card.usualJob ||
      card.standing ||
      (Array.isArray(card.openRequests) && card.openRequests.length) ||
      (Array.isArray(card.recentBookings) && card.recentBookings.length)
  );
}

function speakerPendingOnFile(file) {
  if (!file || typeof file !== 'object') return false;
  if (speakerKnownOnFile(file)) return false;
  return Boolean(
    file.sharedLine ||
      file.name ||
      file.fileOwnerName ||
      file.filePending ||
      fileHasHistory(file)
  );
}

function digitsPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Until this call binds the speaker, hide this phone's visits from OPEN VISITS
 * so a previous caller's job cannot look like occupancy for whoever is on the line.
 */
function selectOpenVisitsForPrompt(visits, card) {
  const rows = Array.isArray(visits) ? visits : [];
  if (!card || typeof card !== 'object') return rows;
  if (returningFileUsable(card)) return rows;
  const phone = digitsPhone(card.phone);
  if (!phone) return [];
  return rows.filter((row) => {
    const rowPhone = digitsPhone(row?.caller_phone || row?.phone);
    return !rowPhone || rowPhone !== phone;
  });
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
      openVisits: householdFile.openVisits,
      nextAppointment: householdFile.nextAppointment,
      nextVisitService: householdFile.nextVisitService,
      nextVisitWhen: householdFile.nextVisitWhen,
      nextVisitStatus: householdFile.nextVisitStatus,
      nextVisitLandmark: householdFile.nextVisitLandmark,
      recentBookings: householdFile.recentBookings,
      ...factsForBoundRole(householdFile, fileRole, boundName),
    };
  }

  return {
    ...base,
    name: boundName,
    greetByName: true,
    lastReason: null,
    notes: null,
    openRequests: [],
    openVisits: [],
    nextAppointment: null,
    nextVisitService: null,
    nextVisitWhen: null,
    nextVisitStatus: null,
    nextVisitLandmark: null,
    recentBookings: [],
    ...factsForBoundRole(householdFile, fileRole, boundName),
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
  const identityBound = Boolean(card.identityBound);
  const fileRole = card.fileRole || null;
  const usable = returningFileUsable({ ...card, fileRole, identityBound });
  const fileOwnerName = fileOwnerNameOf(card);
  const filePending =
    !identityBound &&
    Boolean(card.sharedLine || card.name || fileOwnerName || fileHasHistory(card));
  return {
    sharedLine: Boolean(card.sharedLine),
    greetByName: Boolean(card.greetByName),
    name: card.name || null,
    lastReason: usable ? card.lastReason || null : null,
    openVisits: !usable
      ? []
      : Array.isArray(card.openVisits)
        ? card.openVisits
        : card.nextAppointment
          ? [card.nextAppointment]
          : [],
    nextVisit: usable ? card.nextAppointment || null : null,
    nextVisitService: usable ? card.nextVisitService || null : null,
    nextVisitWhen: usable ? card.nextVisitWhen || null : null,
    nextVisitStatus: usable ? card.nextVisitStatus || null : null,
    nextVisitLandmark: usable ? card.nextVisitLandmark || null : null,
    openRequests: usable && Array.isArray(card.openRequests) ? card.openRequests : [],
    recentBookings: usable && Array.isArray(card.recentBookings) ? card.recentBookings : [],
    place: identityBound ? card.place || null : null,
    usualJob: identityBound ? card.usualJob || null : null,
    standing: identityBound ? card.standing || null : null,
    language: identityBound ? card.language || null : null,
    identityBound,
    boundName: identityBound ? card.boundName || card.name || null : null,
    fileRole,
    fileOwnerName,
    filePending,
    phone: card.phone || null,
  };
}

function openVisitLinesOf(card) {
  if (!card || typeof card !== 'object') return [];
  if (Array.isArray(card.openVisits) && card.openVisits.length) {
    return card.openVisits.filter(Boolean);
  }
  if (card.nextAppointment) return [card.nextAppointment];
  if (card.nextVisit) return [card.nextVisit];
  return [];
}

function stillOpenUseLine() {
  return '- Use: when the caller has confirmed their name and CALL STATE lists an open visit or open request, call save_caller_info if needed and speak nothing about visits — caller_file (backend) speaks every still-open line. Never say a visit does or does not exist. If they want one moved or cancelled, update that one. History only if they mention that job. New ask wins. Do not invent extra visits. Do not re-ask the name.';
}

function formatReturningCallerForPrompt(card) {
  if (!card || typeof card !== 'object') return '';
  const usable = returningFileUsable(card);
  const known = speakerKnownOnFile(card);
  const fileWho = card.fileOwnerName || card.name;
  let identity;
  if (known && usable && card.name) {
    identity = `${card.name} (bound; use this name)`;
  } else if (known && !usable) {
    const who = card.boundName || card.name || 'this speaker';
    identity = `${who} (bound; not the household file; do not invent their history)`;
  } else if (card.sharedLine) {
    const hint = fileWho ? `file name ${fileWho}; ` : '';
    identity = `not bound; shared line (${hint}nothing is saved for this speaker; do not invent a booking, order, or hold)`;
  } else if (fileWho) {
    identity = `not bound; phone file for ${fileWho}; confirm this name once before any visit; do not greet them as this name`;
  } else {
    identity = 'not bound; do not invent a name';
  }

  const lines = [
    'RETURNING CALLER (lived file. Cite a row. Do not read this as a list):',
    `- Speaker: ${identity}`,
  ];

  if (usable) {
    for (const line of openVisitLinesOf(card)) {
      lines.push(`- Open: visit | ${line}`);
    }
    const openRequests = Array.isArray(card.openRequests) ? card.openRequests : [];
    for (const row of openRequests) {
      lines.push(`- Open: ${row}`);
    }
    if (card.lastReason) lines.push(`- Last: ${card.lastReason}`);
    const recentBookings = Array.isArray(card.recentBookings) ? card.recentBookings : [];
    for (const row of recentBookings) {
      lines.push(`- History: ${row}`);
    }
    if (card.place) lines.push(`- Place: ${card.place}`);
    if (card.usualJob) lines.push(`- Usual: ${card.usualJob}`);
    if (card.standing) lines.push(`- Standing: ${card.standing}`);
    if (card.language) lines.push(`- Language: ${card.language}`);
    if (card.notes) lines.push(`- Note: ${card.notes}`);
  } else if (known) {
    if (card.place) lines.push(`- Place: ${card.place}`);
    if (card.usualJob) lines.push(`- Usual: ${card.usualJob}`);
    if (card.standing) lines.push(`- Standing: ${card.standing}`);
    if (card.language) lines.push(`- Language: ${card.language}`);
  }

  if (!known) {
    const mayHaveVisit = Boolean(
      card.nextAppointment ||
      card.nextVisit ||
      card.lastReason ||
      (Array.isArray(card.openRequests) && card.openRequests.length) ||
      (Array.isArray(card.recentBookings) && card.recentBookings.length)
    );
    lines.push(
      mayHaveVisit
        ? `- Use: confirm once, "Am I speaking with ${fileWho || 'the name on this number'}?" Do not greet them as that name. Do not talk about visits yet. If they say no, ask who is speaking and do not read this file. If they confirm, do not list visits yourself — caller_file speaks every still-open line. Never say a visit does or does not exist. Answer what they just said.`
        : '- Use: do not ask who is speaking unless you are about to save something. Do not attach Open, Last, or History yet. Do not greet them as the file name. Answer what they just said.'
    );
  } else if (!usable) {
    lines.push(
      '- Use: this speaker does not own the household file. Do not attach that visit or last reason.'
    );
  } else if (
    openVisitLinesOf(card).length ||
    (Array.isArray(card.openRequests) && card.openRequests.length)
  ) {
    lines.push(stillOpenUseLine());
  } else if (card.lastReason) {
    lines.push(
      '- Use: Last is the default job unless they name a new one. History only if they mention that job. Do not re-ask the name.'
    );
  } else if (Array.isArray(card.recentBookings) && card.recentBookings.length) {
    lines.push(
      '- Use: History only if they mention that job. Do not list it. Do not invent extra visits. Do not re-ask the name.'
    );
  } else {
    lines.push(
      '- Use: first reasoned turn must use this file. Do not start a first-meeting name SOP. Do not invent extra history.'
    );
  }
  return lines.join('\n');
}

function formatReturningFileForCallState(returning) {
  if (!returning || typeof returning !== 'object') return '';
  if (!speakerKnownOnFile(returning)) {
    const who = returning.fileOwnerName || returning.name;
    if (returning.sharedLine) {
      return '- Caller file speaker: not bound. Shared line. Do not ask who is speaking unless you are about to save something. Do not use the file name. Do not attach Open or History. Answer what they just said.';
    }
    if (who) {
      return `- Caller file speaker: not bound. Phone file for ${who}. Ask once: Am I speaking with ${who}? Do not greet them as that name. Do not talk about visits yet. If they say no, do not read this file. Answer what they just said.`;
    }
    return '- Caller file speaker: not bound. Do not attach a visit until they say who they are. Answer what they just said.';
  }
  if (!returningFileUsable(returning)) {
    const who = returning.boundName || returning.name || 'this speaker';
    const lines = [
      `- Caller file speaker: ${who} (bound; not the household file). Do not attach that visit or last reason. Do not re-ask the name.`,
    ];
    if (returning.standing) lines.push(`- Caller file standing: ${returning.standing}`);
    if (returning.language) lines.push(`- Caller file language: ${returning.language}`);
    if (returning.place) lines.push(`- Caller file place: ${returning.place}`);
    return lines.join('\n');
  }
  const lines = [];
  if (returning.name) {
    lines.push(`- Caller file speaker: ${returning.name} (bound). Do not re-ask the name.`);
  } else {
    lines.push('- Caller file speaker: bound. Do not re-ask the name.');
  }
  const visitLines = Array.isArray(returning.openVisits) && returning.openVisits.length
    ? returning.openVisits.filter(Boolean)
    : returning.nextVisit
      ? [returning.nextVisit]
      : [];
  for (const visit of visitLines) {
    lines.push(
      `- Caller file open visit: ${visit}. Speak to that visit. Do not create a second visit unless they ask for a new job.`
    );
  }
  const openRequests = Array.isArray(returning.openRequests) ? returning.openRequests : [];
  for (const row of openRequests) {
    lines.push(`- Caller file open request: ${row}`);
  }
  if (visitLines.length || openRequests.length) {
    lines.push(
      '- Caller file still open: when the caller has confirmed their name and CALL STATE lists an open visit or open request, speak nothing about visits — caller_file speaks every still-open line. Never say a visit does or does not exist.'
    );
  }
  if (returning.lastReason) {
    lines.push(
      `- Caller file last: ${returning.lastReason}. Default job unless they name a new one.`
    );
  }
  if (Array.isArray(returning.recentBookings) && returning.recentBookings.length) {
    lines.push(
      `- Caller file history: ${returning.recentBookings.join('; ')}. If they mention a past job, use that row. Do not list them.`
    );
  }
  if (returning.place) lines.push(`- Caller file place: ${returning.place}`);
  if (returning.usualJob) lines.push(`- Caller file usual: ${returning.usualJob}`);
  if (returning.standing) lines.push(`- Caller file standing: ${returning.standing}`);
  if (returning.language) lines.push(`- Caller file language: ${returning.language}`);
  return lines.join('\n');
}

function seedCallerFromMemory(caller = {}, card) {
  const next = { ...caller };
  if (!card || typeof card !== 'object') return next;
  if (card.phone && !next.phone) next.phone = card.phone;
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
    else delete profile.callerMemory;
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
  selectOpenVisitsForPrompt,
  speakerKnownOnFile,
  speakerPendingOnFile,
};
