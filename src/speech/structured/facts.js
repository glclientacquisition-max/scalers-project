// Grounded facts for one call: every business fact Gemini may state, each
// with a stable id. The ids go into the prompt; Gemini cites them in
// facts_used; verify.js checks each spoken sentence against them.
// Built from the tenant profile the live prompt already loads. No new reads.

const { normalizePolicies, POLICY_LABELS } = require('../../conversation/businessPolicies');
const { coveredByAreas } = require('../../conversation/coverageAreas');
const { formatScheduleSummary } = require('../../conversation/businessHours');
const { statedNumbers } = require('./numbers');

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function titleName(name) {
  return String(name || '').replace(/\b[a-z]+/g, (word) =>
    word === 'cbd' ? 'CBD' : word.charAt(0).toUpperCase() + word.slice(1)
  );
}

function uniqueId(base, used) {
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function serviceRows(profile) {
  const rows = Array.isArray(profile?.servicesCatalog) ? profile.servicesCatalog : [];
  return rows
    .map((row) => (typeof row === 'string' ? { name: row } : row || {}))
    .filter((row) => String(row.name || '').trim());
}

function productRows(profile) {
  const rows = Array.isArray(profile?.productCatalog) ? profile.productCatalog : [];
  return rows.filter((row) => row && String(row.name || row.title || '').trim());
}

function openVisits(state) {
  const rows = state?.returning?.openVisits;
  return Array.isArray(rows) ? rows : [];
}

/**
 * @param {object} profile tenant profile (db.getTenantProfile shape)
 * @param {{ state?: object, speakerBound?: boolean }} [opts]
 */
function buildFactTable(profile = {}, opts = {}) {
  const used = new Set();
  const entries = [];
  const add = (entry) => {
    const text = entry.text;
    entries.push({ ...entry, numbers: statedNumbers(`${entry.label} ${text}`) });
  };

  for (const row of serviceRows(profile)) {
    const label = String(row.name).trim();
    const price = String(row.price_range || row.price || '').trim();
    const notes = String(row.notes || '').trim();
    add({
      id: uniqueId(`svc:${slug(label)}`, used),
      kind: 'service',
      label,
      price,
      text: [price ? `${label}: ${price}` : label, notes ? `(${notes})` : ''].filter(Boolean).join(' '),
    });
  }
  for (const row of productRows(profile)) {
    const label = String(row.name || row.title).trim();
    const price = String(row.price_text || row.price || '').trim();
    add({
      id: uniqueId(`prd:${slug(label)}`, used),
      kind: 'service',
      label,
      price,
      text: price ? `${label}: ${price}` : label,
    });
  }

  const policies = normalizePolicies(profile?.businessPolicies);
  const areas = Array.isArray(policies.coverage_areas) ? policies.coverage_areas : [];
  for (const area of areas) {
    const name = area.slice(area.indexOf(':') + 1);
    add({
      id: uniqueId(`cov:${slug(name)}`, used),
      kind: 'coverage',
      label: titleName(name),
      area,
      text: `Coverage: ${titleName(name)}${area.startsWith('county:') ? ' (whole county)' : ''}`,
    });
  }
  for (const [key, label] of Object.entries(POLICY_LABELS)) {
    if (!policies[key]) continue;
    add({ id: uniqueId(`pol:${key}`, used), kind: 'policy', label, text: `${label}: ${policies[key]}` });
  }

  const hours = formatScheduleSummary(profile?.hoursSchedule);
  if (hours) add({ id: 'hrs:week', kind: 'hours', label: 'Hours', text: `Hours: ${hours}` });

  for (const row of Array.isArray(profile?.businessLocations) ? profile.businessLocations : []) {
    const label = String(row?.name || row?.label || row?.address || '').trim();
    if (!label) continue;
    add({
      id: uniqueId(`loc:${slug(label)}`, used),
      kind: 'location',
      label,
      text: [label, row?.address && row.address !== label ? row.address : ''].filter(Boolean).join(', '),
    });
  }

  // The caller's own open visits only once the speaker is bound to the file.
  if (opts.speakerBound) {
    openVisits(opts.state).forEach((visit, index) => {
      const label = String(visit?.service || visit?.serviceName || visit?.item || 'visit').trim();
      const when = String(visit?.whenText || visit?.when || visit?.window || '').trim();
      add({
        id: `vis:${index + 1}`,
        kind: 'visit',
        label,
        text: [label, when].filter(Boolean).join(', '),
      });
    });
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    entries,
    byId,
    coverageAreas: areas,
    isCovered(placeText) {
      return areas.length ? coveredByAreas(placeText, areas) : null;
    },
  };
}

/** Prompt block. Ids in brackets are what facts_used must cite. */
function formatFactsBlock(table) {
  if (!table?.entries?.length) {
    return 'GROUNDED FACTS: (none on file). State no prices, places or policies; offer to note the question for the team.';
  }
  return [
    'GROUNDED FACTS (the only business facts you may state; cite each one you use by its [id] in facts_used):',
    ...table.entries.map((entry) => `[${entry.id}] ${entry.text}`),
  ].join('\n');
}

module.exports = { buildFactTable, formatFactsBlock, slug };
