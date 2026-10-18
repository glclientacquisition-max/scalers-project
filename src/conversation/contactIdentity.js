const {
  namesLikelySame,
  preferredContactSpelling,
  compactNameKey,
  nameFoldEnabled,
} = require('./callerNameMatch');
const { isJunkCallerName } = require('./callerNameQuality');
const { normalizeKenyaE164 } = require('./liveTransferReady');

const ALT_CAP = 5;

function trimName(raw) {
  const value = String(raw || '').trim();
  return value || null;
}

function namesMatch(a, b) {
  return namesLikelySame(a, b);
}

/** Exact or known-variant match, never the BRAIN_NAME_FOLD sound fold. */
function namesMatchStrict(a, b) {
  return namesLikelySame(a, b, { fold: false });
}

/** Same contract as src/db.js: Kenya E.164, else trimmed original. */
function normalizeStoredPhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  return normalizeKenyaE164(trimmed) || trimmed;
}

/**
 * Writer parse for live persist, CSV, and manual UI.
 * Empty and "unknown" are not a phone file. Kenya variants become E.164.
 * Non-Kenya numbers keep the trimmed original, matching live call writes.
 */
function parseStoredContactPhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') {
    return { ok: false, error: 'Phone is required.' };
  }
  const phone = normalizeStoredPhone(trimmed);
  if (!phone) return { ok: false, error: 'Phone is required.' };
  return { ok: true, phone };
}

/**
 * Owner lock contract (Desk DESK_CONTACT_NAME_LOCK, Voice
 * VOICE_CONTACT_NAME_LOCK, Brain BRAIN_NAME_FOLD), all in contacts.metadata:
 *   single_person: true                       one person on this phone
 *   name_locked: { at, by: 'owner'|'caller' } contacts.name is the spelling
 *   alternate_names_dismissed: [{ name, at }] never add these back
 */
function nameLockOf(metadata) {
  const lock = metadata && typeof metadata === 'object' ? metadata.name_locked : null;
  if (!lock) return null;
  if (typeof lock === 'object' && !Array.isArray(lock)) {
    return { at: lock.at || null, by: lock.by === 'caller' ? 'caller' : 'owner' };
  }
  return { at: null, by: 'owner' };
}

function isSinglePerson(metadata) {
  return Boolean(metadata && typeof metadata === 'object' && metadata.single_person === true);
}

function dismissedAlternateNames(metadata) {
  const list = metadata && typeof metadata === 'object' ? metadata.alternate_names_dismissed : null;
  return (Array.isArray(list) ? list : [])
    .map((row) => trimName(typeof row === 'string' ? row : row?.name))
    .filter(Boolean);
}

function isDismissedName(metadata, name) {
  const key = compactNameKey(name);
  if (!key) return false;
  return dismissedAlternateNames(metadata).some((d) => compactNameKey(d) === key);
}

/** The locked spelling: contacts.name when metadata.name_locked is set. Else null. */
function lockedFileName(metadata, primary) {
  return nameLockOf(metadata) ? trimName(primary) : null;
}

function normalizeAlternates(list, primary) {
  const seen = new Set();
  const next = [];
  for (const row of Array.isArray(list) ? list : []) {
    const name = trimName(row?.name);
    if (!name || isJunkCallerName(name)) continue;
    // BRAIN_NAME_FOLD: a stored STT spelling of the primary stays on the row
    // (history and most-used spelling). Only an exact or known variant drops.
    if (primary && namesMatchStrict(name, primary)) continue;
    const key = compactNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push({
      name,
      seen_at: row.seen_at || null,
      call_id: row.call_id || null,
    });
    if (next.length >= ALT_CAP) break;
  }
  return next;
}

/**
 * Decide primary name + alternate_names for a contact upsert.
 * Empty incoming names never clobber. Differing names log as alternates.
 */
function mergeContactIdentity(existing, incoming = {}) {
  const incomingName = isJunkCallerName(incoming.name)
    ? null
    : trimName(incoming.name);
  const primary = isJunkCallerName(existing?.name) ? null : trimName(existing?.name);
  const baseMeta =
    existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? { ...existing.metadata }
      : {};
  const alternates = Array.isArray(baseMeta.alternate_names)
    ? [...baseMeta.alternate_names]
    : [];

  let name = primary;
  const fold = nameFoldEnabled();
  // BRAIN_NAME_FOLD lock contract: a locked name is never replaced or
  // re-spelled, and nothing is added as an alternate.
  if (fold && primary && nameLockOf(baseMeta)) {
    return {
      name: primary,
      metadata: { ...baseMeta, alternate_names: normalizeAlternates(alternates, primary) },
    };
  }
  // A dismissed name is never added back, and never becomes the name.
  const dismissed = fold && incomingName && isDismissedName(baseMeta, incomingName);
  if (dismissed && primary) {
    return {
      name: primary,
      metadata: { ...baseMeta, alternate_names: normalizeAlternates(alternates, primary) },
    };
  }
  if (incomingName && !primary) {
    name = dismissed ? null : preferredContactSpelling(incomingName, incomingName) || incomingName;
  } else if (incomingName && primary && namesMatchStrict(incomingName, primary)) {
    name = preferredContactSpelling(primary, incomingName) || primary;
  } else if (incomingName && primary && namesMatch(incomingName, primary)) {
    // BRAIN_NAME_FOLD: an STT spelling (Alvin for Alwyn) is the same person.
    // Keep the stored spelling; do not log it as an alternate.
    name = primary;
  } else if (incomingName && primary && !namesMatch(incomingName, primary)) {
    const already = alternates.some((row) => namesMatch(row?.name, incomingName));
    if (!already) {
      alternates.unshift({
        name: incomingName,
        seen_at: incoming.seenAt || new Date().toISOString(),
        call_id: incoming.callId || null,
      });
    }
  }

  return {
    name,
    metadata: {
      ...baseMeta,
      alternate_names: normalizeAlternates(alternates, name),
    },
  };
}

module.exports = {
  ALT_CAP,
  dismissedAlternateNames,
  isDismissedName,
  isSinglePerson,
  lockedFileName,
  nameLockOf,
  mergeContactIdentity,
  namesMatch,
  namesMatchStrict,
  normalizeStoredPhone,
  parseStoredContactPhone,
  trimName,
};
