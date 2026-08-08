// Resolve team-directory escalations and format notify copy.

const { normalizeTeam } = require('./liveKnowledge');

function normalizeQuery(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick the best teammate for an escalate query (name or role).
 * @param {unknown} teamDirectory
 * @param {string} query
 * @returns {{ name: string, role: string, phone: string } | null}
 */
function resolveTeammate(teamDirectory, query) {
  const team = normalizeTeam(teamDirectory);
  if (!team.length) return null;

  const q = normalizeQuery(query);
  if (!q) return team[0];

  const exactName = team.find((m) => normalizeQuery(m.name) === q);
  if (exactName) return exactName;

  const exactRole = team.find((m) => normalizeQuery(m.role) === q);
  if (exactRole) return exactRole;

  const nameIncludes = team.find(
    (m) => normalizeQuery(m.name).includes(q) || q.includes(normalizeQuery(m.name))
  );
  if (nameIncludes) return nameIncludes;

  const roleIncludes = team.find(
    (m) =>
      m.role &&
      (normalizeQuery(m.role).includes(q) || q.includes(normalizeQuery(m.role)))
  );
  if (roleIncludes) return roleIncludes;

  // Keyword overlap (billing, refunds, manager, etc.)
  const tokens = q.split(' ').filter((t) => t.length >= 3);
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
    if (best && bestScore > 0) return best;
  }

  return team[0];
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
} = {}) {
  const who = teammateLabel(teammate);
  const lines = [
    `Escalation for ${who}${businessName ? ` — ${businessName}` : ''}`,
    ``,
    `Caller: ${callerName || '—'}`,
    `Phone: ${callerNumber || '—'}`,
    `Reason: ${reason || '—'}`,
  ];
  if (teammate?.phone) {
    lines.push(`Teammate phone: ${teammate.phone}`);
  }
  if (recordingUrl) lines.push(`Recording: ${recordingUrl}`);
  return lines.join('\n');
}

module.exports = {
  resolveTeammate,
  buildEscalationText,
  teammateLabel,
  normalizeQuery,
};
