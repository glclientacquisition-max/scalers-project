// Resolve team-directory escalations and format notify copy.

const { normalizeTeam } = require('./liveKnowledge');

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
function resolveEscalation(teamDirectory, query) {
  const team = normalizeTeam(teamDirectory);
  const requested = String(query || '').trim();
  if (!team.length) {
    return { teammate: null, match: null, requested };
  }

  const q = normalizeQuery(requested);
  if (!q) {
    return { teammate: team[0], match: 'fallback', requested };
  }

  const exactName = team.find((m) => normalizeQuery(m.name) === q);
  if (exactName) {
    return { teammate: exactName, match: 'exact_name', requested };
  }

  const exactRole = team.find((m) => normalizeQuery(m.role) === q);
  if (exactRole) {
    return { teammate: exactRole, match: 'exact_role', requested };
  }

  const nameIncludes = team.find((m) => {
    const n = normalizeQuery(m.name);
    return n && (n.includes(q) || q.includes(n));
  });
  if (nameIncludes) {
    return { teammate: nameIncludes, match: 'partial', requested };
  }

  const roleIncludes = team.find((m) => {
    const r = normalizeQuery(m.role);
    return r && (r.includes(q) || q.includes(r));
  });
  if (roleIncludes) {
    return { teammate: roleIncludes, match: 'partial', requested };
  }

  // Keyword overlap (billing, refunds, manager, sales, etc.)
  const tokens = roleSeekTokens(requested);
  if (tokens.length) {
    let best = null;
    let bestScore = 0;
    for (const m of team) {
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

  // No sales / billing / etc. — prefer an explicit "General queries" catch-all,
  // then owner/CEO-ish roles, then the first listed person.
  const general = findGeneralQueriesTeammate(team);
  if (general) {
    return { teammate: general, match: 'fallback', requested };
  }

  return { teammate: team[0], match: 'fallback', requested };
}

/** Roles that mean "default inbox for unmatched asks". */
function isGeneralQueriesRole(role) {
  const r = normalizeQuery(role);
  if (!r) return false;
  if (/\bgeneral\b/.test(r) && /\b(quer|inquir|request|support|help|desk|reception)\b/.test(r)) {
    return true;
  }
  if (r === 'general' || r === 'general queries' || r === 'general query') return true;
  if (r === 'front desk' || r === 'reception' || r === 'receptionist') return true;
  return false;
}

function isOwnerishRole(role) {
  const r = normalizeQuery(role);
  return /\b(ceo|owner|founder|director|md|managing director)\b/.test(r);
}

function findGeneralQueriesTeammate(team) {
  const general = team.find((m) => isGeneralQueriesRole(m.role));
  if (general) return general;
  const ownerish = team.find((m) => isOwnerishRole(m.role));
  if (ownerish) return ownerish;
  return null;
}

function teammateLabel(teammate) {
  if (!teammate) return 'the team';
  const role = teammate.role ? ` (${teammate.role})` : '';
  return `${teammate.name}${role}`;
}

/**
 * Owner / teammate alert body for an escalation.
 */
function buildEscalationText({
  businessName,
  teammate,
  callerName,
  reason,
  callerNumber,
  recordingUrl,
  requested,
  match,
} = {}) {
  const who = teammateLabel(teammate);
  const isFallback = match === 'fallback' && requested;
  const lines = [
    isFallback
      ? `Escalation for ${who}${businessName ? ` — ${businessName}` : ''} (fallback)`
      : `Escalation for ${who}${businessName ? ` — ${businessName}` : ''}`,
    ``,
    `Caller: ${callerName || '—'}`,
    `Phone: ${callerNumber || '—'}`,
    `Reason: ${reason || '—'}`,
  ];
  if (isFallback) {
    lines.push(`Caller asked for: ${requested}`);
    lines.push(`Note: no exact match in team directory — routed to ${who}`);
  } else if (requested && match && match !== 'exact_name') {
    lines.push(`Matched on: ${requested}`);
  }
  if (teammate?.phone) {
    lines.push(`Teammate phone: ${teammate.phone}`);
  }
  if (teammate?.email) {
    lines.push(`Teammate email: ${teammate.email}`);
  }
  if (recordingUrl) lines.push(`Recording: ${recordingUrl}`);
  return lines.join('\n');
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
