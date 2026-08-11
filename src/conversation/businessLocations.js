// Normalize tenant business_locations for live ground truth.

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

/**
 * @param {unknown} raw
 * @returns {{ label: string, address: string, landmark: string, directions: string, coverage_notes: string }[]}
 */
function normalizeLocations(raw) {
  return asArray(raw)
    .map((row) => ({
      label: String(row?.label || '').trim(),
      address: String(row?.address || '').trim(),
      landmark: String(row?.landmark || '').trim(),
      directions: String(row?.directions || '').trim(),
      coverage_notes: String(
        row?.coverage_notes || row?.coverageNotes || ''
      ).trim(),
    }))
    .filter(
      (row) =>
        row.label ||
        row.address ||
        row.landmark ||
        row.directions ||
        row.coverage_notes
    )
    .slice(0, 8);
}

function formatLocationsBlock(locations) {
  const rows = normalizeLocations(locations);
  if (!rows.length) return '(none listed)';
  return rows
    .map((loc, i) => {
      const bits = [`${i + 1}. ${loc.label || 'Location'}`];
      if (loc.address) bits.push(`Address: ${loc.address}`);
      if (loc.landmark) bits.push(`Landmark: ${loc.landmark}`);
      if (loc.directions) bits.push(`Directions: ${loc.directions}`);
      if (loc.coverage_notes) bits.push(`Coverage: ${loc.coverage_notes}`);
      return bits.join(' | ');
    })
    .join('\n');
}

module.exports = {
  normalizeLocations,
  formatLocationsBlock,
};
