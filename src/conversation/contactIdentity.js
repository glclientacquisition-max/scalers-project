const ALT_CAP = 5;

function trimName(raw) {
  const value = String(raw || '').trim();
  return value || null;
}

function namesMatch(a, b) {
  const left = trimName(a);
  const right = trimName(b);
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

function normalizeAlternates(list, primary) {
  const seen = new Set();
  const next = [];
  const primaryKey = trimName(primary)?.toLowerCase() || '';
  for (const row of Array.isArray(list) ? list : []) {
    const name = trimName(row?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (primaryKey && key === primaryKey) continue;
    if (seen.has(key)) continue;
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
  const incomingName = trimName(incoming.name);
  const primary = trimName(existing?.name);
  const baseMeta =
    existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? { ...existing.metadata }
      : {};
  const alternates = Array.isArray(baseMeta.alternate_names)
    ? [...baseMeta.alternate_names]
    : [];

  let name = primary;
  if (incomingName && !primary) {
    name = incomingName;
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
