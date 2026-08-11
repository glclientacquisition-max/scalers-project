// Product catalogue helpers for live ground truth (voice).

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

function normalizeInStock(raw) {
  const stockRaw = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['yes', 'true', '1', 'in_stock', 'available'].includes(stockRaw)) {
    return 'yes';
  }
  if (
    ['no', 'false', '0', 'out', 'out_of_stock', 'unavailable'].includes(stockRaw)
  ) {
    return 'no';
  }
  if (['unknown', 'maybe', '?'].includes(stockRaw)) return 'unknown';
  return '';
}

const LIVE_INJECT_MAX = 100;

function normalizeProducts(raw) {
  return asArray(raw)
    .map((row) => {
      const aliasesRaw = row?.aliases ?? row?.alias;
      let aliases = [];
      if (Array.isArray(aliasesRaw)) {
        aliases = aliasesRaw.map((a) => String(a || '').trim()).filter(Boolean);
      } else if (aliasesRaw) {
        aliases = String(aliasesRaw)
          .split(/[,;|]/)
          .map((a) => a.trim())
          .filter(Boolean);
      }
      return {
        name: String(row?.name || '').trim(),
        sku: String(row?.sku || '').trim(),
        category: String(row?.category || '').trim(),
        price: String(row?.price || row?.price_range || row?.priceRange || '').trim(),
        unit: String(row?.unit || '').trim(),
        in_stock: normalizeInStock(row?.in_stock ?? row?.inStock),
        notes: String(row?.notes || '').trim(),
        aliases: aliases.slice(0, 8),
      };
    })
    .filter((row) => row.name);
}

function formatProductsBlock(products) {
  const rows = products.slice(0, LIVE_INJECT_MAX);
  if (!rows.length) return '(none listed)';
  const lines = rows.map((p, i) => {
    const bits = [`${i + 1}. ${p.name}`];
    if (p.category) bits.push(`Category: ${p.category}`);
    if (p.sku) bits.push(`SKU: ${p.sku}`);
    if (p.price) bits.push(`Price: ${p.price}`);
    if (p.unit) bits.push(`Unit: ${p.unit}`);
    if (p.in_stock) bits.push(`In stock: ${p.in_stock}`);
    if (p.aliases.length) bits.push(`Also called: ${p.aliases.join(', ')}`);
    if (p.notes) bits.push(`Notes: ${p.notes}`);
    return bits.join(' | ');
  });
  if (products.length > rows.length) {
    lines.push(
      `(…${products.length - rows.length} more products on file — ask for the exact title; if missing, log an enquiry)`
    );
  }
  return lines.join('\n');
}

module.exports = {
  normalizeProducts,
  formatProductsBlock,
  LIVE_INJECT_MAX,
};
