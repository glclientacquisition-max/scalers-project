'use strict';

/**
 * Owner contact-identity lock on the Voice write path (VOICE_CONTACT_NAME_LOCK).
 * Metadata keys match Desk (DESK_CONTACT_NAME_LOCK) and Brain (BRAIN_NAME_FOLD):
 *   single_person: true
 *   name_locked: { at, by: "owner" }  (also accepts boolean true)
 *   alternate_names_dismissed: [{ name, at }]  (also accepts plain strings)
 *
 * Only the exact value "on" enables the flag. Unset keeps today's merge path.
 */

const { mergeContactIdentity } = require('./contactIdentity');

/** Reads process.env.VOICE_CONTACT_NAME_LOCK (only exact "on" enables; unset = today's path). */
function contactNameLockEnabled(env = process.env) {
  return env.VOICE_CONTACT_NAME_LOCK === 'on';
}

function asMeta(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** Compact key: case- and diacritics-insensitive, trimmed (Desk-compatible). */
function dismissNameKey(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function dismissedNameText(row) {
  if (typeof row === 'string') return String(row).trim() || null;
  if (row && typeof row === 'object') {
    const name = String(row.name || '').trim();
    return name || null;
  }
  return null;
}

function readDismissedList(metadata) {
  const list = asMeta(metadata).alternate_names_dismissed;
  if (!Array.isArray(list)) return [];
  return list;
}

/** True when the owner locked the name or marked the number as one person. */
function isContactNameLocked(metadata) {
  const m = asMeta(metadata);
  if (m.single_person === true) return true;
  const lock = m.name_locked;
  if (lock === true) return true;
  if (lock && typeof lock === 'object' && !Array.isArray(lock)) return true;
  return false;
}

function isNameDismissed(metadata, name) {
  const key = dismissNameKey(name);
  if (!key) return false;
  return readDismissedList(metadata).some((row) => dismissNameKey(dismissedNameText(row)) === key);
}

function filterDismissedAlternates(alternates, metadata) {
  const list = Array.isArray(alternates) ? alternates : [];
  return list.filter((row) => !isNameDismissed(metadata, row?.name));
}

/**
 * Decide name + metadata for upsertContact.
 * Flag off → mergeContactIdentity exactly as today.
 * Flag on + locked/single_person → keep existing name, add no alternate.
 * Flag on (any contact) → never (re-)add a dismissed alternate.
 * favourite_at and every other metadata key stay on the existing object.
 */
function resolveContactIdentityForUpsert(existing, incoming = {}, env = process.env) {
  if (!contactNameLockEnabled(env)) {
    return mergeContactIdentity(existing, incoming);
  }

  const baseMeta = asMeta(existing?.metadata);

  if (existing && isContactNameLocked(baseMeta)) {
    const alternates = Array.isArray(baseMeta.alternate_names)
      ? [...baseMeta.alternate_names]
      : [];
    return {
      name: existing.name == null || existing.name === '' ? null : existing.name,
      metadata: {
        ...baseMeta,
        alternate_names: filterDismissedAlternates(alternates, baseMeta),
      },
    };
  }

  const identity = mergeContactIdentity(existing, incoming);
  return {
    name: identity.name,
    metadata: {
      ...identity.metadata,
      alternate_names: filterDismissedAlternates(identity.metadata.alternate_names, baseMeta),
    },
  };
}

module.exports = {
  contactNameLockEnabled,
  dismissNameKey,
  filterDismissedAlternates,
  isContactNameLocked,
  isNameDismissed,
  resolveContactIdentityForUpsert,
};
