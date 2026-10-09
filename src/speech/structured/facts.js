// Grounded facts for one call: every business fact Gemini may state, each
// with a stable id. The ids go into the prompt; Gemini cites them in
// facts_used; verify.js checks each spoken sentence against them.
// Built from the tenant profile the live prompt already loads. No new reads.

const { normalizePolicies, POLICY_LABELS } = require('../../conversation/businessPolicies');
const { coveredByAreas } = require('../../conversation/coverageAreas');
const { formatScheduleSummary } = require('../../conversation/businessHours');
const { speakableCoverage } = require('./coverageSource');
const { statedNumbers } = require('./numbers');
const { visitFact } = require('./spokenFactsSource');

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

/** The caller file has open visits or requests (loaded at call start). */
function fileHasRows(state) {
  const returning = state?.returning;
  if (!returning || typeof returning !== 'object') return false;
  if (returning.hasOpenRows === true) return true;
  return ['openRows', 'openVisits', 'openRequests'].some((key) => Array.isArray(returning[key]) && returning[key].length > 0);
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
  // BRAIN_CONFIRMED_COVERAGE on: only owner-confirmed areas (else none).
  // Off: the stored list, as before.
  const coverage = speakableCoverage(profile, { env: opts.env });
  const areas = coverage.areas;
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
    // VOICE_SPOKEN_FACTS on: card-line visits and rendered phrases (spokenFactsSource).
    openVisits(opts.state).forEach((visit, index) => {
      const fact = visitFact(visit, { env: opts.env, now: opts.now });
      add({ id: `vis:${index + 1}`, kind: 'visit', ...fact });
    });
  }

  // HD_1b3a67ea7ee9: before the name confirm the file is masked, not empty.
  // Its visits stay out of the table, so say so; an empty table read as
  // "no bookings saved under this number".
  const callerFile = opts.speakerBound ? 'bound' : fileHasRows(opts.state) ? 'masked' : 'none';

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    callerFile,
    entries,
    byId,
    coverageAreas: areas,
    coverageGate: { gated: coverage.gated, confirmed: coverage.confirmed },
    isCovered(placeText) {
      return areas.length ? coveredByAreas(placeText, areas) : null;
    },
  };
}

const MASKED_FILE_RULE =
  'CALLER FILE: MASKED, not empty. This number has open visits or requests on file, hidden until the speaker confirms their name. Never say there are no bookings, visits or records for this number. Confirm who is speaking first, then the file can be read.';

/** Prompt block. Ids in brackets are what facts_used must cite. */
function formatFactsBlock(table) {
  const unconfirmed = table?.coverageGate?.gated && !table.coverageGate.confirmed;
  const coverageRule = unconfirmed
    ? ['COVERAGE: the owner has not confirmed any service area. Never say we cover, serve or do not cover a place, and never list areas. For a place, say the team will confirm it.']
    : [];
  const fileRule = table?.callerFile === 'masked' ? [MASKED_FILE_RULE] : [];
  if (!table?.entries?.length) {
    return [
      'GROUNDED FACTS: (none on file). State no prices, places or policies; offer to note the question for the team.',
      ...coverageRule,
      ...fileRule,
    ].join('\n');
  }
  return [
    'GROUNDED FACTS (the only business facts you may state; cite each one you use by its [id] in facts_used):',
    ...table.entries.map((entry) => `[${entry.id}] ${entry.text}`),
    ...coverageRule,
    ...fileRule,
  ].join('\n');
}

module.exports = { buildFactTable, formatFactsBlock, slug, fileHasRows, MASKED_FILE_RULE };
