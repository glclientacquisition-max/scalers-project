const { namesLikelySame, preferredContactSpelling, compactNameKey } = require('./callerNameMatch');
const { isJunkCallerName } = require('./callerNameQuality');

const ALT_CAP = 5;

function trimName(raw) {
  const value = String(raw || '').trim();
  return value || null;
}

function namesMatch(a, b) {
  return namesLikelySame(a, b);
}

function normalizeAlternates(list, primary) {
  const seen = new Set();
  const next = [];
  for (const row of Array.isArray(list) ? list : []) {
    const name = trimName(row?.name);
    if (!name || isJunkCallerName(name)) continue;
    if (primary && namesMatch(name, primary)) continue;
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
  if (incomingName && !primary) {
    name = preferredContactSpelling(incomingName, incomingName) || incomingName;
  } else if (incomingName && primary && namesMatch(incomingName, primary)) {
    name = preferredContactSpelling(primary, incomingName) || primary;
  } else if (incomingName && primary && !namesMatch(incomingName, primary)) {
    const key = incomingName.toLowerCase();
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
  mergeContactIdentity,
  namesMatch,
  trimName,
};
