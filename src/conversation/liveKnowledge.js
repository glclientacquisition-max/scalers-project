// Format structured tenant knowledge for live call injection.

function asArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeServices(raw) {
  return asArray(raw)
    .map((row) => ({
      name: String(row?.name || '').trim(),
      price_range: String(row?.price_range || row?.priceRange || '').trim(),
      notes: String(row?.notes || '').trim(),
      out_of_scope: String(row?.out_of_scope || row?.outOfScope || '').trim(),
    }))
    .filter((row) => row.name);
}

function normalizeFaqs(raw) {
  return asArray(raw)
    .map((row) => ({
      question: String(row?.question || '').trim(),
      answer: String(row?.answer || '').trim(),
    }))
    .filter((row) => row.question && row.answer);
}

function normalizeTeam(raw) {
  return asArray(raw)
    .map((row) => ({
      name: String(row?.name || '').trim(),
      role: String(row?.role || '').trim(),
      phone: String(row?.phone || '').trim(),
    }))
    .filter((row) => row.name);
}

function formatServicesBlock(services) {
  if (!services.length) return '(none listed)';
  return services
    .map((s, i) => {
      const bits = [`${i + 1}. ${s.name}`];
      if (s.price_range) bits.push(`Price: ${s.price_range}`);
      if (s.notes) bits.push(`Notes: ${s.notes}`);
      if (s.out_of_scope) bits.push(`Out of scope: ${s.out_of_scope}`);
      return bits.join(' | ');
    })
    .join('\n');
}

function formatFaqsBlock(faqs) {
  if (!faqs.length) return '(none listed)';
  return faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
}

function formatTeamBlock(team) {
  if (!team.length) return '(none listed)';
  return team
    .map((m) => {
      const role = m.role ? ` (${m.role})` : '';
      const phone = m.phone ? `; phone ${m.phone}` : '';
      return `- ${m.name}${role}${phone}`;
    })
    .join('\n');
}

/**
 * Authoritative live facts injected on every call.
 * Prefer these over older compiled prose if there is a conflict.
 */
function buildLiveGroundTruth(profile = {}) {
  const { parseAgentTools } = require('./agentTools');
  const { parseVertical } = require('./vertical');
  const { parseHandoffMode } = require('./handoffMode');
  const { normalizeLocations, formatLocationsBlock } = require('./businessLocations');
  const {
    normalizePolicies,
    policiesHaveContent,
    formatPoliciesBlock,
  } = require('./businessPolicies');

  const services = normalizeServices(profile.servicesCatalog);
  const faqs = normalizeFaqs(profile.faqs);
  const team = normalizeTeam(profile.teamDirectory);
  const locations = normalizeLocations(profile.businessLocations);
  const policies = normalizePolicies(profile.businessPolicies);
  const unknown = String(profile.unknownAnswerFallback || '').trim();
  const extras = String(profile.servicesNotes || profile.servicesOffered || '').trim();
  const tools = parseAgentTools(profile.agentTools);
  const vertical = parseVertical(profile.vertical);
  const handoffMode = parseHandoffMode(profile.handoffMode);

  const hasAny =
    services.length ||
    faqs.length ||
    team.length ||
    locations.length ||
    policiesHaveContent(policies) ||
    unknown ||
    extras;
  if (!hasAny) return '';

  const parts = [
    'LIVE GROUND TRUTH (highest priority facts — if this conflicts with older prompt text, follow THIS):',
    '',
    `BUSINESS VERTICAL: ${vertical}`,
    `HANDOFF MODE: ${handoffMode}${
      handoffMode === 'live_transfer'
        ? ' (prefer connecting a human when asked; if transfer is unavailable, take a callback note and escalate)'
        : ' (notify via WhatsApp/email callback — do not claim a live transfer)'
    }`,
    '',
    'LOCATIONS & DIRECTIONS:',
    formatLocationsBlock(locations),
    '',
    'SERVICES CATALOG:',
    formatServicesBlock(services),
  ];

  if (extras && services.length) {
    // Avoid dumping a duplicate auto-summary: only append if it looks like owner notes.
    const looksLikeAutoSummary = /^Services:\n/i.test(extras) || /Out of scope:/i.test(extras);
    if (!looksLikeAutoSummary) {
      parts.push('', 'SERVICE NOTES:', extras);
    }
  } else if (extras && !services.length) {
    parts.push('', 'SERVICE NOTES:', extras);
  }

  parts.push('', 'POLICIES:', formatPoliciesBlock(policies));

  parts.push('', 'GOLDEN FAQs (answer these exactly when asked):', formatFaqsBlock(faqs));

  if (tools.escalate) {
    parts.push(
      '',
      'TEAM DIRECTORY (escalation — you are the receptionist, not the expert):',
      formatTeamBlock(team),
      !team.length
        ? 'ESCALATION: No team directory on file. Do not invent staff. Capture name + reason and say the business will follow up.'
        : `ESCALATION RULES:
- Prefer matching the caller's ask to a Name or Role above. A role like "General queries" is the catch-all for unmatched asks.
- If a caller is angry, asks for a refund/billing, or matches a role above: acknowledge, say that teammate will follow up shortly, capture name + reason, and append the escalate tool with that teammate name or role.
- If they ask for a role or person NOT on this list (e.g. "sales guy" but only CEO / General queries is listed): do NOT invent staff. Say you do not have that specialist on file, offer General queries or the owner/CEO to follow up, then escalate. In the escalate tool, set teammate to who they asked for (e.g. "sales") so the system can fall back and tag the notify.
- Do not invent live transfers or claim you already WhatsApped them.`
    );
  } else if (team.length) {
    parts.push(
      '',
      'TEAM DIRECTORY (for your awareness — escalate tool is OFF for this business):',
      formatTeamBlock(team),
      'Do NOT append the escalate tool. If a caller is angry or asks for someone: acknowledge, capture name + reason, and say the business will follow up.'
    );
  } else {
    parts.push(
      '',
      'ESCALATION: escalate tool is OFF. Capture name + reason and say the business will follow up. Do not invent staff.'
    );
  }

  if (unknown) {
    parts.push(
      '',
      'UNKNOWN REQUEST LINE (say this when asked for something outside knowledge):',
      `"${unknown}"`
    );
  }

  parts.push(
    '',
    'Never invent prices, stock, availability, services, locations, policies, people, or FAQ answers outside this ground truth.',
    'Resolve the caller\'s request from this truth when you can. Capture a clear next step. Only hand off when the playbook or caller requires a human.'
  );

  return parts.filter((p, i, arr) => !(p === '' && arr[i - 1] === '')).join('\n');
}

/** Human-readable services blob for tenants.services_offered / compiler. */
function formatServicesForCompiler(services, extraNotes = '') {
  const rows = normalizeServices(services);
  const lines = rows.map((s) => {
    const bits = [`- ${s.name}`];
    if (s.price_range) bits.push(`price ${s.price_range}`);
    if (s.notes) bits.push(s.notes);
    if (s.out_of_scope) bits.push(`out of scope: ${s.out_of_scope}`);
    return bits.join(' - ');
  });
  const catalog = lines.length ? `Services:\n${lines.join('\n')}` : '';
  const notes = String(extraNotes || '').trim();
  if (catalog && notes) return `${catalog}\n\nAdditional notes:\n${notes}`;
  return catalog || notes;
}

module.exports = {
  normalizeServices,
  normalizeFaqs,
  normalizeTeam,
  buildLiveGroundTruth,
  formatServicesForCompiler,
};
