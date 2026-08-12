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
  const all = normalizeProducts(products);
  const rows = all.slice(0, LIVE_INJECT_MAX);
  if (!rows.length) return '(none listed)';
  const lines = rows.map((p, i) => {
    const bits = [`${i + 1}. ${p.name}`];
    if (p.category) bits.push(`Category: ${p.category}`);
    if (p.sku) bits.push(`SKU: ${p.sku}`);
    // Always emit a Price field so the model cannot fill silence with an invented number.
    bits.push(
      p.price
        ? `Price: ${p.price}`
        : 'Price: unknown (do not invent a number — say you do not have the exact price)'
    );
    if (p.unit) bits.push(`Unit: ${p.unit}`);
    if (p.in_stock) bits.push(`In stock: ${p.in_stock}`);
    if (p.aliases.length) bits.push(`Also called: ${p.aliases.join(', ')}`);
    if (p.notes) bits.push(`Notes: ${p.notes}`);
    return bits.join(' | ');
  });
  if (all.length > rows.length) {
    lines.push(
      `(…${all.length - rows.length} more products on file — ask for the exact title; if missing, log an enquiry)`
    );
  }
  lines.push(
    'PRICE RULE: Speak a money amount only when Price is a concrete value above. If Price is unknown, admit you do not have the exact price and offer a quote/enquiry — never guess KSh amounts.'
  );
  return lines.join('\n');
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+\s:'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find a catalogue product for a hold/order item string.
 * Exact name/sku/alias preferred; otherwise a clear containment match.
 * @returns {{product: object, matched: string, score: number}|null}
 */
function findProductMatch(item, rawCatalog) {
  const needle = normalizeMatchText(item);
  if (!needle || needle.length < 2) return null;
  const products = normalizeProducts(rawCatalog);
  let best = null;
  for (const product of products) {
    const terms = [product.name, product.sku, ...product.aliases].filter(Boolean);
    for (const term of terms) {
      const hay = normalizeMatchText(term);
      if (!hay) continue;
      let score = 0;
      if (hay === needle) score = 1000 + hay.length;
      else if (hay.includes(needle) || needle.includes(hay)) {
        const shorter = Math.min(hay.length, needle.length);
        const longer = Math.max(hay.length, needle.length);
        // Avoid weak overlaps like "the" matching inside longer titles.
        if (shorter < 4 && longer > shorter + 2) continue;
        if (shorter / longer < 0.5) continue;
        score = 100 + shorter;
      } else {
        continue;
      }
      if (!best || score > best.score) {
        best = { product, matched: term, score };
      }
    }
  }
  return best;
}

module.exports = {
  normalizeProducts,
  formatProductsBlock,
  LIVE_INJECT_MAX,
  findProductMatch,
  normalizeMatchText,
};
