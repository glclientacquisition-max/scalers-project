// Team-directory notify permissions. Who may receive a message is explicit.
// Unmigrated directories (no flags on any row) infer from role and owner phone.
// Once any row has flags, missing flags are false. Never pick team[0].

function asArray(raw) {
  return Array.isArray(raw) ? raw : [];
}

function phoneKey(raw) {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  }
  return digits;
}

function phonesMatch(a, b) {
  const left = phoneKey(a);
  const right = phoneKey(b);
  return Boolean(left && right && left === right);
}

function directoryHasExplicitPermissions(raw) {
  return asArray(raw).some((row) => {
    if (!row || typeof row !== 'object') return false;
    return (
      typeof row.receives_escalation === 'boolean' ||
      typeof row.receives_inbox === 'boolean' ||
      typeof row.receives_ops === 'boolean'
    );
  });
}

function isGeneralQueriesRole(role) {
  const r = String(role || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!r) return false;
  if (
    /\bgeneral\b/.test(r) &&
    /\b(quer|inquir|request|support|help|desk|reception)\b/.test(r)
  ) {
    return true;
  }
  if (r === 'general' || r === 'general queries' || r === 'general query') {
    return true;
  }
  if (r === 'front desk' || r === 'reception' || r === 'receptionist') {
    return true;
  }
  return false;
}

function isOwnerishRole(role) {
  const r = String(role || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\b(ceo|owner|founder|director|md|managing director)\b/.test(r);
}

function inferInbox(row, ownerPhone) {
  if (isGeneralQueriesRole(row.role) || isOwnerishRole(row.role)) return true;
  if (ownerPhone && phonesMatch(row.phone, ownerPhone)) return true;
  return false;
}

function normalizeNotifyMember(row, ctx = {}) {
  const name = String(row?.name || '').trim();
  const role = String(row?.role || '').trim();
  const phone = String(row?.phone || '').trim();
  const email = String(row?.email || '')
    .trim()
    .toLowerCase();
  const explicit = Boolean(ctx.explicit);
  const receives_escalation = explicit
    ? row?.receives_escalation === true
    : Boolean(phone);
  const receives_inbox = explicit
    ? row?.receives_inbox === true
    : inferInbox({ role, phone }, ctx.ownerPhone);
  const receives_ops = explicit
    ? row?.receives_ops === true
    : receives_inbox;
  return {
    name,
    role,
    phone,
    email,
    receives_escalation,
    receives_inbox,
    receives_ops,
  };
}

function normalizeNotifyTeam(raw, ctx = {}) {
  const explicit = directoryHasExplicitPermissions(raw);
  return asArray(raw)
    .map((row) =>
      normalizeNotifyMember(row, { ...ctx, explicit })
    )
    .filter((row) => row.name);
}

function uniqueDestinations(people) {
  const seen = new Set();
  const out = [];
  for (const person of people || []) {
    const phone = phoneKey(person.phone);
    const email = String(person.email || '')
      .trim()
      .toLowerCase();
    const key = phone || (email ? `email:${email}` : '');
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(person);
  }
  return out;
}

function findNotifyCatchAll(team) {
  const rows = Array.isArray(team) ? team : [];
  const general = rows.find(
    (m) => isGeneralQueriesRole(m.role) && m.receives_escalation
  );
  if (general) return general;
  const inbox = rows.find((m) => m.receives_inbox && m.receives_escalation);
  if (inbox) return inbox;
  return null;
}

function staffRecipients(kind, opts = {}) {
  const flag =
    kind === 'ops'
      ? 'receives_ops'
      : kind === 'escalation'
        ? 'receives_escalation'
        : 'receives_inbox';
  const team = normalizeNotifyTeam(opts.teamDirectory, {
    ownerPhone: opts.ownerPhone,
  });
  const picked = uniqueDestinations(
    team.filter((row) => row[flag] && (row.phone || row.email))
  );
  if (picked.length) {
    return { recipients: picked, source: 'team' };
  }
  const explicit = directoryHasExplicitPermissions(opts.teamDirectory);
  if (!explicit && (opts.ownerPhone || opts.ownerEmail)) {
    return {
      recipients: uniqueDestinations([
        {
          name: 'Inbox',
          role: '',
          phone: String(opts.ownerPhone || '').trim(),
          email: String(opts.ownerEmail || '')
            .trim()
            .toLowerCase(),
          receives_escalation: false,
          receives_inbox: true,
          receives_ops: true,
        },
      ]),
      source: 'legacy_owner',
    };
  }
  return { recipients: [], source: 'none' };
}

module.exports = {
  directoryHasExplicitPermissions,
  findNotifyCatchAll,
  inferInbox,
  isGeneralQueriesRole,
  isOwnerishRole,
  normalizeNotifyMember,
  normalizeNotifyTeam,
  phoneKey,
  phonesMatch,
  staffRecipients,
  uniqueDestinations,
};
