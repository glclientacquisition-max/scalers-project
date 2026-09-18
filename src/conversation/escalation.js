// Resolve team-directory escalations and format notify copy.
// Recipients come from team permissions. Never invent a person. Never pick team[0].

const {
  findNotifyCatchAll,
  isGeneralQueriesRole,
  normalizeNotifyTeam,
} = require('./teamPermissions');
const { escalationBody } = require('../notifications/templates');

function normalizeQuery(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip filler words so "the sales guy" → "sales". */
function roleSeekTokens(query) {
  const stop = new Set([
    'the',
    'a',
    'an',
    'guy',
    'girl',
    'person',
    'people',
    'team',
    'department',
    'dept',
    'someone',
    'anybody',
    'please',
    'for',
    'to',
    'speak',
    'talk',
    'with',
    'want',
    'need',
    'looking',
    'kwa',
    'na',
    'ya',
  ]);
  return normalizeQuery(query)
    .split(' ')
    .filter((t) => t.length >= 2 && !stop.has(t));
}

/**
 * Pick the best teammate for an escalate query (name or role).
 * @param {unknown} teamDirectory
 * @param {string} query
 * @returns {{ name: string, role: string, phone: string } | null}
 */
function resolveTeammate(teamDirectory, query) {
  return resolveEscalation(teamDirectory, query).teammate;
}

/**
 * Full escalation resolution with match quality.
 * Use when the caller asks for a role that may not exist (e.g. "sales"
 * but directory only has CEO) — still route to a real person, never invent one.
 *
 * @returns {{
 *   teammate: { name: string, role: string, phone: string } | null,
 *   match: 'exact_name'|'exact_role'|'partial'|'fallback'|null,
 *   requested: string,
 * }}
 */
function resolveEscalation(teamDirectory, query, opts = {}) {
  const team = normalizeNotifyTeam(teamDirectory, {
    ownerPhone: opts.ownerPhone,
  });
  const allowed = team.filter((m) => m.receives_escalation);
  const requested = String(query || '').trim();
  const catchAll = findNotifyCatchAll(team);

  if (!team.length) {
    return { teammate: null, match: null, requested };
  }

  const q = normalizeQuery(requested);
  if (!q) {
    return catchAll
      ? { teammate: catchAll, match: 'fallback', requested }
      : { teammate: null, match: null, requested };
  }

  const exactName = allowed.find((m) => normalizeQuery(m.name) === q);
  if (exactName) {
    return { teammate: exactName, match: 'exact_name', requested };
  }

  const exactRole = allowed.find((m) => normalizeQuery(m.role) === q);
  if (exactRole) {
    return { teammate: exactRole, match: 'exact_role', requested };
  }

  const nameIncludes = allowed.find((m) => {
    const n = normalizeQuery(m.name);
    return n && (n.includes(q) || q.includes(n));
  });
  if (nameIncludes) {
    return { teammate: nameIncludes, match: 'partial', requested };
  }

  const roleIncludes = allowed.find((m) => {
    const r = normalizeQuery(m.role);
    return r && (r.includes(q) || q.includes(r));
  });
  if (roleIncludes) {
    return { teammate: roleIncludes, match: 'partial', requested };
  }

  const tokens = roleSeekTokens(requested);
  if (
    /\b(manager|boss|owner|supervisor|director|ceo|md)\b/i.test(requested) ||
    tokens.some((t) =>
      ['manager', 'boss', 'owner', 'supervisor', 'director', 'ceo'].includes(t)
    )
  ) {
    if (catchAll) {
      return { teammate: catchAll, match: 'fallback', requested };
    }
  }
  if (tokens.length) {
    let best = null;
    let bestScore = 0;
    for (const m of allowed) {
      const hay = `${normalizeQuery(m.name)} ${normalizeQuery(m.role)}`;
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    if (best && bestScore > 0) {
      return { teammate: best, match: 'partial', requested };
    }
  }

  if (catchAll) {
    return { teammate: catchAll, match: 'fallback', requested };
  }

  return { teammate: null, match: null, requested };
}

function findGeneralQueriesTeammate(team) {
  return findNotifyCatchAll(normalizeNotifyTeam(team));
}

function teammateLabel(teammate) {
  if (!teammate) return 'the team';
  const role = teammate.role ? ` (${teammate.role})` : '';
  return `${teammate.name}${role}`;
}

/**
 * Owner / teammate alert body for an escalation.
 */
function buildEscalationText(opts = {}) {
  return escalationBody(opts);
}

module.exports = {
  resolveTeammate,
  resolveEscalation,
  buildEscalationText,
  teammateLabel,
  normalizeQuery,
  roleSeekTokens,
  isGeneralQueriesRole,
  findGeneralQueriesTeammate,
};
